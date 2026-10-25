package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/chanceygardener/show-me/internal/protocol"
	"github.com/chanceygardener/show-me/internal/registry"
	"github.com/chanceygardener/show-me/internal/transport"
)

// fakeEditor stands in for an editor at the transport boundary.
type fakeEditor struct {
	pid   int
	down  bool
	reply func(protocol.Request) protocol.Reply
	got   []protocol.Request
}

func ok(result any) protocol.Reply {
	data, _ := json.Marshal(result)
	return protocol.Reply{OK: true, Result: data}
}

// accepting is an editor that accepts every request.
func accepting(pid int) *fakeEditor {
	return &fakeEditor{pid: pid, reply: func(req protocol.Request) protocol.Reply {
		switch req.Command {
		case protocol.CommandDeck:
			return ok(protocol.DeckResult{Deck: 7})
		case protocol.CommandView:
			return ok(protocol.ViewResult{View: 2})
		case protocol.CommandDone:
			return ok(protocol.DoneResult{Deck: req.Deck, Views: 2, OpenHint: "<leader>v1"})
		default:
			return ok(protocol.StatusResult{Editor: "nvim", WorkspaceFolders: []string{"/w"}, Current: &protocol.CurrentDeck{Deck: 7, Title: "T", Views: 2}})
		}
	}}
}

type harness struct {
	app          *app
	out, err     *bytes.Buffer
	editors      []*fakeEditor
	incompatible []registry.Candidate
}

func newHarness(t *testing.T, editors ...*fakeEditor) *harness {
	h := &harness{out: &bytes.Buffer{}, err: &bytes.Buffer{}, editors: editors}
	h.app = &app{
		cwd:    t.TempDir(),
		stdout: h.out,
		stderr: h.err,
		locate: func(cwd string) (registry.Ranking, error) {
			r := registry.Ranking{Dir: "/registry", Targets: []string{cwd}, Incompatible: h.incompatible}
			for _, e := range h.editors {
				c := registry.Candidate{File: "nvim-" + strconv.Itoa(e.pid) + ".json", Entry: protocol.Entry{
					Protocol: protocol.Version, Editor: "nvim", PID: e.pid, WorkspaceFolders: []string{cwd},
					Transport: protocol.Transport{Kind: protocol.TransportNvim, Address: strconv.Itoa(e.pid)},
				}}
				r.All, r.Ranked = append(r.All, c), append(r.Ranked, c)
			}
			r.All = append(r.All, h.incompatible...)
			return r, nil
		},
		send: func(t protocol.Transport, req protocol.Request) (protocol.Reply, error) {
			for _, e := range h.editors {
				if strconv.Itoa(e.pid) != t.Address {
					continue
				}
				if e.down {
					return protocol.Reply{}, &transport.Unreachable{Address: t.Address, Err: errors.New("connection refused")}
				}
				e.got = append(e.got, req)
				return e.reply(req), nil
			}
			return protocol.Reply{}, errors.New("no such editor")
		},
	}
	return h
}

func (h *harness) run(args ...string) int {
	h.out.Reset()
	h.err.Reset()
	return h.app.run(args)
}

func (h *harness) file(t *testing.T, name string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(h.app.cwd, name), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func expect(t *testing.T, h *harness, code, want int, stdout string) {
	t.Helper()
	if code != want || h.out.String() != stdout {
		t.Fatalf("exit %d (want %d)\nstdout %q (want %q)\nstderr %q", code, want, h.out.String(), stdout, h.err.String())
	}
}

func TestDeck(t *testing.T) {
	e := accepting(100)
	h := newHarness(t, e)
	expect(t, h, h.run("deck", "How login works"), exitOK, "deck 7@100\n")
	if req := e.got[0]; req.Protocol != protocol.Version || req.Title != "How login works" {
		t.Fatalf("sent %+v", req)
	}
}

func TestDeckBlankTitleNeverReachesTheEditor(t *testing.T) {
	e := accepting(100)
	h := newHarness(t, e)
	expect(t, h, h.run("deck", "  "), exitRejected, "")
	if h.err.String() != "show-me: a deck needs a title\n" || len(e.got) != 0 {
		t.Fatalf("stderr %q, sent %d", h.err.String(), len(e.got))
	}
}

func TestView(t *testing.T) {
	e := accepting(100)
	h := newHarness(t, e)
	h.file(t, "a.txt")
	h.file(t, "-dash.txt")
	expect(t, h, h.run("view", "7@100", "cols2", "--title", "Both", "a.txt:1", "--", "-dash.txt"), exitOK, "view 2\n")
	req := e.got[0]
	if req.Deck != 7 || req.View.Title != "Both" || len(req.View.Panes) != 2 || !strings.HasSuffix(req.View.Panes[1].Path, "-dash.txt") {
		t.Fatalf("sent %+v / %+v", req, req.View)
	}
	expect(t, h, h.run("view", "7", "single", "--title=Eq", "a.txt"), exitOK, "view 2\n")
	if e.got[1].View.Title != "Eq" {
		t.Fatalf("--title=: sent %+v", e.got[1].View)
	}
}

func TestViewUsageErrors(t *testing.T) {
	h := newHarness(t, accepting(100))
	h.file(t, "-dash.txt")
	for _, args := range [][]string{
		{"view", "7", "single", "-dash.txt"},
		{"view", "seven", "single", "a.txt"},
		{"view", "7@x", "single", "a.txt"},
		{"view", "7", "single", "a.txt", "--title"},
		{"view", "7"},
	} {
		if code := h.run(args...); code != exitUsage {
			t.Errorf("%v: exit %d, stderr %q", args, code, h.err.String())
		}
	}
	h.run("view", "7", "single", "-dash.txt")
	if !strings.Contains(h.err.String(), "put -- before panes") {
		t.Errorf("leading dash hint missing: %q", h.err.String())
	}
}

func TestViewRejectedByTheCLI(t *testing.T) {
	e := accepting(100)
	h := newHarness(t, e)
	h.file(t, "a.txt")
	expect(t, h, h.run("view", "7", "grid", "a.txt"), exitRejected, "")
	if want := "show-me: unknown layout \"grid\" (valid: single, cols2, cols3, main-stack)\n"; h.err.String() != want || len(e.got) != 0 {
		t.Fatalf("stderr %q, sent %d", h.err.String(), len(e.got))
	}
}

func TestEditorRejection(t *testing.T) {
	e := accepting(100)
	e.reply = func(protocol.Request) protocol.Reply { return protocol.Reply{Error: "unknown deck 99"} }
	h := newHarness(t, e)
	expect(t, h, h.run("done", "99"), exitRejected, "")
	if h.err.String() != "show-me: unknown deck 99\n" {
		t.Fatalf("stderr %q", h.err.String())
	}
}

func TestDoneAndStatus(t *testing.T) {
	h := newHarness(t, accepting(100))
	expect(t, h, h.run("done", "7@100"), exitOK, "done 7@100\nopen: <leader>v1\n")
	expect(t, h, h.run("status"), exitOK, "editor: nvim (pid 100)\nworkspace: /w\ncurrent: deck 7@100 \"T\" (2 views)\n")
}

func TestUsageAndVersion(t *testing.T) {
	h := newHarness(t)
	if code := h.run(); code != exitUsage {
		t.Errorf("no args: exit %d", code)
	}
	if code := h.run("frobnicate"); code != exitUsage || !strings.Contains(h.err.String(), `unknown command "frobnicate"`) {
		t.Errorf("unknown command: exit %d, %q", code, h.err.String())
	}
	expect(t, h, h.run("version"), exitOK, "show-me dev (protocol 1)\n")
}

func TestNoEditors(t *testing.T) {
	h := newHarness(t)
	expect(t, h, h.run("deck", "x"), exitUnreachable, "")
	if !strings.Contains(h.err.String(), "no editor is serving") {
		t.Fatalf("stderr %q", h.err.String())
	}
}

func TestFallsThroughAnUnreachableEditor(t *testing.T) {
	down, up := accepting(100), accepting(200)
	down.down = true
	h := newHarness(t, down, up)
	expect(t, h, h.run("deck", "x"), exitOK, "deck 7@200\n")
}

func TestAllEditorsUnreachable(t *testing.T) {
	a, b := accepting(100), accepting(200)
	a.down, b.down = true, true
	h := newHarness(t, a, b)
	expect(t, h, h.run("deck", "x"), exitUnreachable, "")
	if !strings.Contains(h.err.String(), "no editor answered") || !strings.Contains(h.err.String(), "connection refused") {
		t.Fatalf("stderr %q", h.err.String())
	}
}

func TestHandleRoutesToItsEditor(t *testing.T) {
	first, owner := accepting(100), accepting(200)
	h := newHarness(t, first, owner)
	expect(t, h, h.run("done", "7@200"), exitOK, "done 7@200\nopen: <leader>v1\n")
	if len(first.got) != 0 || len(owner.got) != 1 {
		t.Fatalf("sent to first %d, owner %d", len(first.got), len(owner.got))
	}
}

func TestHandleForAnExitedEditor(t *testing.T) {
	h := newHarness(t, accepting(100))
	expect(t, h, h.run("done", "7@999"), exitUnreachable, "")
	if !strings.Contains(h.err.String(), "no longer running") {
		t.Fatalf("stderr %q", h.err.String())
	}
}

func TestProtocolMismatch(t *testing.T) {
	h := newHarness(t)
	h.incompatible = []registry.Candidate{{File: "nvim-300.json", Entry: protocol.Entry{Protocol: 2, Editor: "nvim", PID: 300}}}
	expect(t, h, h.run("deck", "x"), exitProtocol, "")
	if !strings.Contains(h.err.String(), "update the show-me CLI") {
		t.Fatalf("stderr %q", h.err.String())
	}

	e := accepting(100)
	e.reply = func(protocol.Request) protocol.Reply {
		return protocol.Reply{Error: "unsupported protocol 1 (this editor speaks 2)"}
	}
	h = newHarness(t, e)
	expect(t, h, h.run("deck", "x"), exitProtocol, "")
}

func TestEditors(t *testing.T) {
	h := newHarness(t, accepting(100), accepting(200))
	if code := h.run("editors"); code != exitOK {
		t.Fatalf("exit %d", code)
	}
	lines := strings.Split(strings.TrimSpace(h.out.String()), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "* nvim") || !strings.HasPrefix(lines[1], "  nvim") {
		t.Fatalf("stdout %q", h.out.String())
	}
}
