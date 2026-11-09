package daemon

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/pkg/agent"
)

const qwenSettingsFixture = `{
  // Qwen Code accepts comments in its settings.
  "env": { "BAILIAN_KEY": "secret-value" },
  "model": { "name": "plan-max" },
  "modelProviders": {
    "openai": [
      { "id": "plan-max", "name": "[Plan] max", "baseUrl": "https://private.example.test/v1", "envKey": "BAILIAN_KEY" },
      { "id": "plan-flash", "baseUrl": "https://private.example.test/v1" },
      { "name": "no id" },
    ],
    "anthropic": [
      { "id": "plan-max", "name": "duplicate of openai" },
      { "id": "other", "name": "Other" }
    ],
    "gemini": "not-a-list"
  }
}`

func writeQwenSettings(t *testing.T, content string) string {
	t.Helper()
	qwenHome := t.TempDir()
	if err := os.WriteFile(filepath.Join(qwenHome, "settings.json"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("QWEN_HOME", qwenHome)
	return qwenHome
}

func TestLoadQwenConfiguredModels(t *testing.T) {
	writeQwenSettings(t, qwenSettingsFixture)

	models, err := loadQwenConfiguredModels(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := []agent.Model{
		{ID: "plan-max", Label: "duplicate of openai"},
		{ID: "other", Label: "Other"},
		{ID: "plan-flash", Label: "plan-flash"},
	}
	if len(models) != len(want) {
		t.Fatalf("models = %+v, want %+v", models, want)
	}
	for i := range want {
		if models[i].ID != want[i].ID || models[i].Label != want[i].Label || models[i].Provider != "" {
			t.Errorf("models[%d] = %+v, want %+v", i, models[i], want[i])
		}
	}
}

func TestLoadQwenConfiguredModelsReadsDefaultHome(t *testing.T) {
	t.Setenv("QWEN_HOME", "")
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".qwen"), 0o755); err != nil {
		t.Fatal(err)
	}
	settings := `{"modelProviders":{"openai":[{"id":"m"}]}}`
	if err := os.WriteFile(filepath.Join(home, ".qwen", "settings.json"), []byte(settings), 0o600); err != nil {
		t.Fatal(err)
	}

	models, err := loadQwenConfiguredModels(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID != "m" {
		t.Fatalf("models = %+v", models)
	}
}

func TestLoadQwenConfiguredModelsWithoutProviders(t *testing.T) {
	t.Setenv("QWEN_HOME", filepath.Join(t.TempDir(), "missing"))
	models, err := loadQwenConfiguredModels(t.TempDir())
	if err != nil || len(models) != 0 {
		t.Fatalf("missing settings: models = %+v, err = %v", models, err)
	}

	writeQwenSettings(t, `{"model":{"name":"m"}}`)
	models, err = loadQwenConfiguredModels(t.TempDir())
	if err != nil || len(models) != 0 {
		t.Fatalf("no modelProviders: models = %+v, err = %v", models, err)
	}

	writeQwenSettings(t, `{"modelProviders":`)
	if _, err = loadQwenConfiguredModels(t.TempDir()); err == nil {
		t.Fatal("malformed settings: expected an error")
	}
}

func stubEmptyQwenDiscovery(t *testing.T, fx *modelListFixture) {
	t.Helper()
	orig := listModels
	listModels = func(context.Context, string, agent.Command) (agent.Catalog, error) {
		return agent.Catalog{Models: []agent.Model{}}, nil
	}
	t.Cleanup(func() { listModels = orig })

	d := fx.daemon
	d.cfg.Agents = map[string]AgentEntry{"qwen": {Path: fakeExecutable(t, "qwen")}}
	d.runtimeIndex["rt-qwen"] = Runtime{ID: "rt-qwen", Provider: "qwen"}
}

func TestHandleModelList_QwenReportsConfiguredModelsOnly(t *testing.T) {
	fx := newModelListFixture(t)
	stubEmptyQwenDiscovery(t, fx)
	writeQwenSettings(t, qwenSettingsFixture)

	fx.daemon.handleModelList(context.Background(), fx.daemon.runtimeIndex["rt-qwen"], "req-1")

	_, _, _, report := fx.snapshot()
	models, _ := report["models"].([]any)
	if len(models) != 3 {
		t.Fatalf("report = %+v", report)
	}
	if report["status"] != "completed" {
		t.Errorf("status = %v", report["status"])
	}
	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private.example.test", "BAILIAN_KEY", "secret-value"} {
		if strings.Contains(string(raw), private) {
			t.Errorf("report leaks %q: %s", private, raw)
		}
	}
}

func TestHandleModelList_QwenKeepsManualEntryWhenSettingsAreMalformed(t *testing.T) {
	fx := newModelListFixture(t)
	stubEmptyQwenDiscovery(t, fx)
	writeQwenSettings(t, `{"modelProviders":`)

	fx.daemon.handleModelList(context.Background(), fx.daemon.runtimeIndex["rt-qwen"], "req-1")

	_, _, _, report := fx.snapshot()
	models, _ := report["models"].([]any)
	if report["status"] != "completed" || len(models) != 0 {
		t.Fatalf("report = %+v", report)
	}
}
