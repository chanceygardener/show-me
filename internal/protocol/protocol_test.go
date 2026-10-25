package protocol

import (
	"encoding/json"
	"testing"
)

func TestRequestOmitsUnsetFields(t *testing.T) {
	data, err := json.Marshal(Request{Protocol: Version, Command: CommandStatus})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), `{"protocol":1,"command":"status"}`; got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestViewRequestShape(t *testing.T) {
	req := Request{
		Protocol: Version,
		Command:  CommandView,
		Deck:     7,
		View:     &View{Layout: "cols2", Panes: []Pane{{Path: "/a", First: 2, Last: 4}, {Path: "/b"}}},
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"protocol":1,"command":"view","deck":7,"view":{"layout":"cols2","panes":[{"path":"/a","first":2,"last":4},{"path":"/b"}]}}`
	if string(data) != want {
		t.Fatalf("got %s, want %s", data, want)
	}
}

func TestReplyDecodesNullCurrent(t *testing.T) {
	var reply Reply
	body := `{"ok":true,"result":{"editor":"nvim","workspace_folders":["/w"],"current":null}}`
	if err := json.Unmarshal([]byte(body), &reply); err != nil {
		t.Fatal(err)
	}
	var status StatusResult
	if err := json.Unmarshal(reply.Result, &status); err != nil {
		t.Fatal(err)
	}
	if !reply.OK || status.Current != nil || status.WorkspaceFolders[0] != "/w" {
		t.Fatalf("decoded %+v / %+v", reply, status)
	}
}

func TestEveryLayoutHasPaneCounts(t *testing.T) {
	for _, name := range Layouts {
		if _, ok := PaneCounts[name]; !ok {
			t.Errorf("layout %q has no pane counts", name)
		}
	}
	if len(PaneCounts) != len(Layouts) {
		t.Errorf("PaneCounts has %d layouts, Layouts has %d", len(PaneCounts), len(Layouts))
	}
}
