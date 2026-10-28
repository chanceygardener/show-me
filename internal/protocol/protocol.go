// Package protocol defines what the show-me CLI and editors exchange: the
// requests and replies on the wire, and the registry entries editors publish.
//
// These types are the contract in protocol/PROTOCOL.md. protocol/schema.json is
// generated from them (go generate), and the VS Code extension's types are
// generated from that. Changing any of them bumps Version, in the CLI and
// every editor in the same release.
package protocol

import "encoding/json"

//go:generate go run ./schemagen -o ../../protocol/schema.json

// Version is the only protocol version this build speaks.
const Version = 1

// Commands an editor understands.
const (
	CommandDeck   = "deck"
	CommandView   = "view"
	CommandDone   = "done"
	CommandStatus = "status"
)

// Editors that publish registry entries.
const (
	EditorNvim   = "nvim"
	EditorVSCode = "vscode"
)

// Transport kinds the CLI speaks.
const (
	// TransportNvim is Neovim's own msgpack-RPC server, called with nvim_exec_lua.
	TransportNvim = "nvim"
	// TransportNDJSON is one JSON request line and one JSON reply line over a
	// Unix socket or named pipe, authenticated by the entry's token (VS Code).
	TransportNDJSON = "ndjson"
)

// Layouts lists the approved layouts in documented order.
var Layouts = []string{"single", "cols2", "cols3", "main-stack"}

// PaneRange is the inclusive range of pane counts a layout accepts.
type PaneRange struct{ Min, Max int }

// PaneCounts gives the pane counts each layout accepts.
var PaneCounts = map[string]PaneRange{
	"single":     {1, 1},
	"cols2":      {2, 2},
	"cols3":      {3, 3},
	"main-stack": {3, 4},
}

// Request is one CLI call to an editor.
type Request struct {
	Protocol int    `json:"protocol"`
	Token    string `json:"token,omitempty"`
	Command  string `json:"command" jsonschema:"enum=deck,enum=view,enum=done,enum=status"`
	Title    string `json:"title,omitempty"`
	Deck     int    `json:"deck,omitempty"`
	View     *View  `json:"view,omitempty"`
}

// View is one approved layout filled with panes, in reading order.
type View struct {
	Layout string `json:"layout" jsonschema:"enum=single,enum=cols2,enum=cols3,enum=main-stack"`
	Title  string `json:"title,omitempty"`
	Panes  []Pane `json:"panes"`
}

// Pane is a file with an optional highlighted line range.
type Pane struct {
	Path  string `json:"path"`            // absolute, cleaned
	First int    `json:"first,omitempty"` // 1-based
	Last  int    `json:"last,omitempty"`  // 1-based, inclusive
}

// Reply is an editor's answer. Result's shape depends on the command.
type Reply struct {
	OK     bool            `json:"ok"`
	Error  string          `json:"error,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
}

// DeckResult answers CommandDeck.
type DeckResult struct {
	Deck int `json:"deck"`
}

// ViewResult answers CommandView with the view's number within its deck.
type ViewResult struct {
	View int `json:"view"`
}

// DoneResult answers CommandDone.
type DoneResult struct {
	Deck     int    `json:"deck"`
	Views    int    `json:"views"`
	OpenHint string `json:"open_hint"`
}

// StatusResult answers CommandStatus. Current is nil when no deck is done yet.
type StatusResult struct {
	Editor           string       `json:"editor" jsonschema:"enum=nvim,enum=vscode"`
	WorkspaceFolders []string     `json:"workspace_folders"`
	Current          *CurrentDeck `json:"current" jsonschema:"nullable"`
}

// CurrentDeck summarizes the deck an editor's view keys act on.
type CurrentDeck struct {
	Deck  int    `json:"deck"`
	Title string `json:"title"`
	Views int    `json:"views"`
}

// Entry is the registry file a running editor publishes so the CLI can find
// it: <base>/editors/<editor>-<pid>.json.
type Entry struct {
	Protocol         int       `json:"protocol"`
	Editor           string    `json:"editor" jsonschema:"enum=nvim,enum=vscode"`
	PID              int       `json:"pid"`
	WorkspaceFolders []string  `json:"workspace_folders"`
	Transport        Transport `json:"transport"`
	OpenHint         string    `json:"open_hint"`
	StartedAt        int64     `json:"started_at"` // epoch ms
	FocusedAt        int64     `json:"focused_at"` // epoch ms
}

// Transport says how to reach an editor.
type Transport struct {
	Kind    string `json:"kind" jsonschema:"enum=nvim,enum=ndjson"`
	Address string `json:"address"`
	Token   string `json:"token,omitempty"`
}
