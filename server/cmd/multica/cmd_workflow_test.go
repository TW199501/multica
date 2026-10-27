package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

const (
	testWorkflowUUID = "22222222-2222-2222-2222-222222222222"
	testProjectUUID  = "33333333-3333-3333-3333-333333333333"
)

func newWorkflowTestCmd(addFlags func(*cobra.Command)) *cobra.Command {
	cmd := &cobra.Command{Use: "test"}
	addFlags(cmd)
	return cmd
}

func TestParseStatusMapping(t *testing.T) {
	got, err := parseStatusMapping([]string{"in_review=todo", " qa = done "})
	if err != nil {
		t.Fatalf("parseStatusMapping: %v", err)
	}
	if got["in_review"] != "todo" || got["qa"] != "done" || len(got) != 2 {
		t.Fatalf("mapping = %#v", got)
	}
	for _, bad := range [][]string{{"in_review"}, {"=todo"}, {"in_review="}, {"a=b", "a=c"}} {
		if _, err := parseStatusMapping(bad); err == nil {
			t.Fatalf("parseStatusMapping(%q) = nil error, want error", bad)
		}
	}
}

func TestRunWorkflowCreateSendsStepsAsJSON(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/issue-workflows" {
			t.Fatalf("request = %s %s, want POST /api/issue-workflows", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": testWorkflowUUID, "name": body["name"]})
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newWorkflowTestCmd(addWorkflowCreateFlags)
	_ = cmd.Flags().Set("name", "Review")
	_ = cmd.Flags().Set("steps", `[{"status_key":"todo"},{"status_key":"in_review","handler":{"type":"project_lead"}}]`)

	if _, err := captureStdout(t, func() error { return runWorkflowCreate(cmd, nil) }); err != nil {
		t.Fatalf("runWorkflowCreate: %v", err)
	}
	steps, _ := body["steps"].([]any)
	if body["name"] != "Review" || len(steps) != 2 {
		t.Fatalf("body = %#v, want name and two steps", body)
	}
	if _, ok := body["description"]; ok {
		t.Fatalf("body = %#v, want no description", body)
	}
}

func TestRunWorkflowCreateRejectsMalformedStepsBeforeRequest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newWorkflowTestCmd(addWorkflowCreateFlags)
	_ = cmd.Flags().Set("name", "Review")
	_ = cmd.Flags().Set("steps", `{"status_key":"todo"}`)

	err := runWorkflowCreate(cmd, nil)
	if err == nil || !strings.Contains(err.Error(), "JSON array") {
		t.Fatalf("err = %v, want JSON array error", err)
	}
}

func TestRunWorkflowHandoffKeepsFieldsNotPassed(t *testing.T) {
	var putPath string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": testWorkflowUUID,
				"steps": []any{
					map[string]any{"status_key": "todo", "handler": map[string]any{"type": "none"}},
					map[string]any{
						"status_key":      "in_review",
						"handler":         map[string]any{"type": "agent", "id": "agent-1"},
						"instructions":    "Review the diff",
						"next_status_key": "done",
						"back_status_key": "todo",
					},
				},
			})
		case http.MethodPut:
			putPath = r.URL.Path
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": testWorkflowUUID})
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newWorkflowTestCmd(addWorkflowHandoffFlags)
	_ = cmd.Flags().Set("instructions", "Check the tests too")

	if _, err := captureStdout(t, func() error {
		return runWorkflowHandoff(cmd, []string{testWorkflowUUID, "in_review"})
	}); err != nil {
		t.Fatalf("runWorkflowHandoff: %v", err)
	}
	if putPath != "/api/issue-workflows/"+testWorkflowUUID+"/handoffs/in_review" {
		t.Fatalf("PUT path = %q", putPath)
	}
	handler, _ := body["handler"].(map[string]any)
	if handler["type"] != "agent" || handler["id"] != "agent-1" {
		t.Fatalf("handler = %#v, want the current agent kept", handler)
	}
	if body["instructions"] != "Check the tests too" || body["next_status_key"] != "done" || body["back_status_key"] != "todo" {
		t.Fatalf("body = %#v, want new instructions and kept next/back", body)
	}
}

func TestRunWorkflowHandoffChangingTypeDropsOldHandlerID(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": testWorkflowUUID,
				"steps": []any{map[string]any{
					"status_key": "in_review",
					"handler":    map[string]any{"type": "agent", "id": "agent-1"},
				}},
			})
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": testWorkflowUUID})
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newWorkflowTestCmd(addWorkflowHandoffFlags)
	_ = cmd.Flags().Set("handler-type", "project_lead")

	if _, err := captureStdout(t, func() error {
		return runWorkflowHandoff(cmd, []string{testWorkflowUUID, "in_review"})
	}); err != nil {
		t.Fatalf("runWorkflowHandoff: %v", err)
	}
	handler, _ := body["handler"].(map[string]any)
	if handler["type"] != "project_lead" {
		t.Fatalf("handler = %#v, want project_lead", handler)
	}
	if _, ok := handler["id"]; ok {
		t.Fatalf("handler = %#v, want the agent id dropped", handler)
	}
}

func TestRunWorkflowHandoffRejectsUnknownStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("unexpected %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": testWorkflowUUID, "steps": []any{}})
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newWorkflowTestCmd(addWorkflowHandoffFlags)
	err := runWorkflowHandoff(cmd, []string{testWorkflowUUID, "in_review"})
	if err == nil || !strings.Contains(err.Error(), `"in_review"`) {
		t.Fatalf("err = %v, want unknown status error", err)
	}
}

func TestRunProjectWorkflowDefaultSendsNullWithMapping(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/projects/"+testProjectUUID+"/workflow" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"project": map[string]any{"id": testProjectUUID}, "updated_issues": 2})
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newWorkflowTestCmd(addProjectWorkflowFlags)
	_ = cmd.Flags().Set("map", "in_review=todo")

	if _, err := captureStdout(t, func() error {
		return runProjectWorkflow(cmd, []string{testProjectUUID, "default"})
	}); err != nil {
		t.Fatalf("runProjectWorkflow: %v", err)
	}
	if v, ok := body["workflow_id"]; !ok || v != nil {
		t.Fatalf("workflow_id = %#v (present %v), want explicit null", v, ok)
	}
	mapping, _ := body["status_mapping"].(map[string]any)
	if mapping["in_review"] != "todo" {
		t.Fatalf("status_mapping = %#v", mapping)
	}
}

func TestRunProjectWorkflowResolvesWorkflowByName(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/api/issue-workflows" {
			_ = json.NewEncoder(w).Encode(map[string]any{"workflows": []any{
				map[string]any{"id": testWorkflowUUID, "name": "Code Review"},
			}})
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]any{"project": map[string]any{"id": testProjectUUID}})
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newWorkflowTestCmd(addProjectWorkflowFlags)
	if _, err := captureStdout(t, func() error {
		return runProjectWorkflow(cmd, []string{testProjectUUID, "code review"})
	}); err != nil {
		t.Fatalf("runProjectWorkflow: %v", err)
	}
	if body["workflow_id"] != testWorkflowUUID {
		t.Fatalf("workflow_id = %#v, want %s", body["workflow_id"], testWorkflowUUID)
	}
}

func TestRunProjectWorkflowExplainsRequiredMapping(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": `choose a destination status for the 3 issue(s) on "in_review"`,
			"code":  "workflow_status_mapping_required",
			"plan": map[string]any{"required": []any{
				map[string]any{"status_key": "in_review", "issue_count": 3, "suggested_status_key": "todo"},
			}},
		})
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newWorkflowTestCmd(addProjectWorkflowFlags)
	err := runProjectWorkflow(cmd, []string{testProjectUUID, "default"})
	if err == nil {
		t.Fatal("runProjectWorkflow = nil error, want mapping error")
	}
	msg := cli.FormatError(err, false)
	if !strings.Contains(msg, "--map in_review=todo") || !strings.Contains(msg, "3 issue(s)") {
		t.Fatalf("message = %q, want the mapping hint", msg)
	}
}
