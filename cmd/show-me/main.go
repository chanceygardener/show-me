// Command show-me lets coding agents illustrate an explanation in the user's
// editor: a deck of numbered views, each a layout of files with highlighted
// ranges, which the user opens at their own pace.
//
// protocol/PROTOCOL.md is the full contract; skills/show-me/SKILL.md is how
// agents are told to use it.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/chanceygardener/show-me/internal/check"
	"github.com/chanceygardener/show-me/internal/protocol"
	"github.com/chanceygardener/show-me/internal/registry"
	"github.com/chanceygardener/show-me/internal/transport"
)

// version is set at release time with -ldflags "-X main.version=...".
var version = "dev"

// Exit codes. Agents branch on these, so they never change meaning.
const (
	exitOK          = 0
	exitRejected    = 1
	exitUsage       = 2
	exitUnreachable = 3
	exitProtocol    = 4
)

const usage = `usage:
  show-me deck <title>
  show-me view <deck> <layout> [--title T] [--] <pane>...
  show-me done <deck>
  show-me status
  show-me editors
  show-me version

layouts: single (1 pane), cols2 (2), cols3 (3), main-stack (3-4)
pane:    path, path:N, or path:N-M
deck:    the handle "deck" printed, like 7@4242
exit:    0 ok, 1 rejected, 2 usage, 3 no reachable editor, 4 protocol mismatch
`

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "show-me:", err)
		os.Exit(exitUnreachable)
	}
	a := &app{cwd: cwd, stdout: os.Stdout, stderr: os.Stderr, locate: registry.Locate, send: transport.Send}
	os.Exit(a.run(os.Args[1:]))
}

// app is one CLI invocation. locate and send are fields so tests can stand
// in for the registry and the editor.
type app struct {
	cwd    string
	stdout io.Writer
	stderr io.Writer
	locate func(cwd string) (registry.Ranking, error)
	send   func(protocol.Transport, protocol.Request) (protocol.Reply, error)
}

// failure carries an exit code and a message out of a subcommand.
type failure struct {
	code int
	msg  string
}

func (f *failure) Error() string { return f.msg }

func fail(code int, format string, args ...any) *failure {
	return &failure{code: code, msg: fmt.Sprintf(format, args...)}
}

// handle names a deck and the editor holding it, printed as "7@4242". A bare
// "7" (pid 0) leaves the choice of editor to the registry's ranking.
type handle struct{ deck, pid int }

func (h handle) String() string { return fmt.Sprintf("%d@%d", h.deck, h.pid) }

func parseHandle(text string) (handle, error) {
	num, pid, qualified := strings.Cut(text, "@")
	bad := fail(exitUsage, "deck must look like 7@4242 or 7, got %q", text)
	deck, err := strconv.Atoi(num)
	if err != nil || deck < 1 {
		return handle{}, bad
	}
	h := handle{deck: deck}
	if qualified {
		if h.pid, err = strconv.Atoi(pid); err != nil || h.pid < 1 {
			return handle{}, bad
		}
	}
	return h, nil
}

func (a *app) run(args []string) int {
	if len(args) == 0 {
		fmt.Fprint(a.stderr, usage)
		return exitUsage
	}
	var err error
	switch args[0] {
	case "deck":
		err = a.deck(args[1:])
	case "view":
		err = a.view(args[1:])
	case "done":
		err = a.done(args[1:])
	case "status":
		err = a.status(args[1:])
	case "editors":
		err = a.editors(args[1:])
	case "version":
		fmt.Fprintf(a.stdout, "show-me %s (protocol %d)\n", version, protocol.Version)
	case "help", "-h", "--help":
		fmt.Fprint(a.stdout, usage)
	default:
		err = fail(exitUsage, "unknown command %q\n\n%s", args[0], usage)
	}
	return a.report(err)
}

// report prints err for the agent and returns the exit code it maps to.
func (a *app) report(err error) int {
	if err == nil {
		return exitOK
	}
	var rejection *check.Rejection
	if errors.As(err, &rejection) {
		fmt.Fprintln(a.stderr, "show-me:", rejection.Reason)
		return exitRejected
	}
	var f *failure
	if errors.As(err, &f) {
		fmt.Fprintln(a.stderr, "show-me:", strings.TrimRight(f.msg, "\n"))
		return f.code
	}
	fmt.Fprintln(a.stderr, "show-me:", err)
	return exitUnreachable
}

func (a *app) deck(args []string) error {
	if len(args) != 1 {
		return fail(exitUsage, "usage: show-me deck <title>")
	}
	if err := check.Title(args[0]); err != nil {
		return err
	}
	var result protocol.DeckResult
	editor, err := a.call(nil, protocol.Request{Command: protocol.CommandDeck, Title: args[0]}, &result)
	if err != nil {
		return err
	}
	fmt.Fprintf(a.stdout, "deck %s\n", handle{result.Deck, editor.Entry.PID})
	return nil
}

func (a *app) view(args []string) error {
	if len(args) < 2 {
		return fail(exitUsage, "usage: show-me view <deck> <layout> [--title T] [--] <pane>...")
	}
	h, err := parseHandle(args[0])
	if err != nil {
		return err
	}
	title, specs, err := splitViewArgs(args[2:])
	if err != nil {
		return err
	}
	view, err := check.View(args[1], specs, title, a.cwd)
	if err != nil {
		return err
	}
	var result protocol.ViewResult
	if _, err := a.call(&h, protocol.Request{Command: protocol.CommandView, Deck: h.deck, View: &view}, &result); err != nil {
		return err
	}
	fmt.Fprintf(a.stdout, "view %d\n", result.View)
	return nil
}

// splitViewArgs separates --title from the panes. Anything else starting with
// "-" before "--" is a usage error, so a typo never becomes a pane.
func splitViewArgs(args []string) (title string, panes []string, err error) {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--":
			return title, append(panes, args[i+1:]...), nil
		case arg == "--title":
			if i+1 >= len(args) {
				return "", nil, fail(exitUsage, "--title needs a value")
			}
			title = args[i+1]
			i++
		case strings.HasPrefix(arg, "--title="):
			title = strings.TrimPrefix(arg, "--title=")
		case strings.HasPrefix(arg, "-") && arg != "-":
			return "", nil, fail(exitUsage, "unknown option %s (put -- before panes that start with -)", arg)
		default:
			panes = append(panes, arg)
		}
	}
	return title, panes, nil
}

func (a *app) done(args []string) error {
	if len(args) != 1 {
		return fail(exitUsage, "usage: show-me done <deck>")
	}
	h, err := parseHandle(args[0])
	if err != nil {
		return err
	}
	var result protocol.DoneResult
	editor, err := a.call(&h, protocol.Request{Command: protocol.CommandDone, Deck: h.deck}, &result)
	if err != nil {
		return err
	}
	fmt.Fprintf(a.stdout, "done %s\nopen: %s\n", handle{result.Deck, editor.Entry.PID}, result.OpenHint)
	return nil
}

func (a *app) status(args []string) error {
	if len(args) != 0 {
		return fail(exitUsage, "usage: show-me status")
	}
	var result protocol.StatusResult
	editor, err := a.call(nil, protocol.Request{Command: protocol.CommandStatus}, &result)
	if err != nil {
		return err
	}
	fmt.Fprintf(a.stdout, "editor: %s (pid %d)\n", result.Editor, editor.Entry.PID)
	fmt.Fprintf(a.stdout, "workspace: %s\n", strings.Join(result.WorkspaceFolders, ", "))
	if c := result.Current; c != nil {
		fmt.Fprintf(a.stdout, "current: deck %s %q (%d views)\n", handle{c.Deck, editor.Entry.PID}, c.Title, c.Views)
	} else {
		fmt.Fprintln(a.stdout, "current: none")
	}
	return nil
}

func (a *app) editors(args []string) error {
	if len(args) != 0 {
		return fail(exitUsage, "usage: show-me editors")
	}
	ranking, err := a.locate(a.cwd)
	if err != nil {
		return fail(exitUnreachable, "reading the editor registry: %v", err)
	}
	if len(ranking.All) == 0 {
		fmt.Fprintf(a.stdout, "no editors registered in %s\n", ranking.Dir)
		return nil
	}
	for _, c := range ranking.All {
		mark := " "
		if len(ranking.Ranked) > 0 && ranking.Ranked[0].File == c.File {
			mark = "*"
		}
		fmt.Fprintf(a.stdout, "%s %-6s pid %-7d protocol %d  %s\n", mark, c.Entry.Editor, c.Entry.PID, c.Entry.Protocol, strings.Join(c.Entry.WorkspaceFolders, ", "))
	}
	return nil
}

// call sends req to the editor the handle names, or else to the best-ranked
// editor that answers, and decodes the result into out. It returns the
// editor that replied.
func (a *app) call(h *handle, req protocol.Request, out any) (registry.Candidate, error) {
	req.Protocol = protocol.Version
	ranking, err := a.locate(a.cwd)
	if err != nil {
		return registry.Candidate{}, fail(exitUnreachable, "reading the editor registry: %v", err)
	}
	candidates := ranking.Ranked
	if h != nil && h.pid != 0 {
		c, found := ranking.ByPID(h.pid)
		if !found {
			return registry.Candidate{}, fail(exitUnreachable, "the editor holding deck %s (pid %d) is no longer running; start a new deck", *h, h.pid)
		}
		if c.Entry.Protocol != protocol.Version {
			return registry.Candidate{}, protocolMismatch(c)
		}
		candidates = []registry.Candidate{c}
	}
	if len(candidates) == 0 {
		if len(ranking.Incompatible) > 0 {
			return registry.Candidate{}, protocolMismatch(ranking.Incompatible[0])
		}
		return registry.Candidate{}, fail(exitUnreachable, "no editor is serving %s (%d registered in %s; see `show-me editors`)",
			strings.Join(ranking.Targets, " or "), len(ranking.All), ranking.Dir)
	}

	var tried []string
	for _, c := range candidates {
		reply, err := a.send(c.Entry.Transport, req)
		if err != nil {
			tried = append(tried, fmt.Sprintf("%s pid %d: %v", c.Entry.Editor, c.Entry.PID, err))
			continue
		}
		if !reply.OK {
			if strings.HasPrefix(reply.Error, "unsupported protocol") {
				return c, fail(exitProtocol, "%s; update the show-me CLI or the editor plugin so they match", reply.Error)
			}
			return c, &check.Rejection{Reason: reply.Error}
		}
		if err := json.Unmarshal(reply.Result, out); err != nil {
			return c, fail(exitUnreachable, "%s pid %d sent an unreadable result: %v", c.Entry.Editor, c.Entry.PID, err)
		}
		return c, nil
	}
	return registry.Candidate{}, fail(exitUnreachable, "no editor answered:\n  %s", strings.Join(tried, "\n  "))
}

func protocolMismatch(c registry.Candidate) error {
	side := "the show-me CLI"
	if c.Entry.Protocol < protocol.Version {
		side = "the editor plugin"
	}
	return fail(exitProtocol, "%s pid %d speaks protocol %d, this CLI speaks %d; update %s",
		c.Entry.Editor, c.Entry.PID, c.Entry.Protocol, protocol.Version, side)
}
