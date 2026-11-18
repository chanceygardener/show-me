// Command schemagen writes protocol/schema.json, the JSON Schema of every
// shape the CLI and editors exchange. Run it with `go generate ./internal/protocol`.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/invopop/jsonschema"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// document gathers every exchanged shape under one root, so each becomes a
// named definition that generated code can refer to.
type document struct {
	Request      protocol.Request      `json:"request"`
	Reply        protocol.Reply        `json:"reply"`
	DeckResult   protocol.DeckResult   `json:"deck_result"`
	ViewResult   protocol.ViewResult   `json:"view_result"`
	DoneResult   protocol.DoneResult   `json:"done_result"`
	StatusResult protocol.StatusResult `json:"status_result"`
	Entry        protocol.Entry        `json:"entry"`
}

func main() {
	out := flag.String("o", "", "file to write the schema to")
	flag.Parse()
	if *out == "" {
		fmt.Fprintln(os.Stderr, "schemagen: -o is required")
		os.Exit(2)
	}
	// ExpandedStruct inlines the root: json-schema-to-typescript rejects a top-level $ref.
	schema := (&jsonschema.Reflector{ExpandedStruct: true}).Reflect(&document{})
	schema.Title = "ShowMeProtocol"
	schema.Description = fmt.Sprintf("show-me protocol %d. Generated from internal/protocol; do not edit.", protocol.Version)
	data, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "schemagen:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*out, append(data, '\n'), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "schemagen:", err)
		os.Exit(1)
	}
}
