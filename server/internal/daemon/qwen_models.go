package daemon

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/multica-ai/multica/server/pkg/agent"
)

// qwenUserSettingsPath returns the settings file Qwen Code reads. QWEN_HOME
// replaces its global ~/.qwen directory.
func qwenUserSettingsPath(home string) string {
	qwenHome := strings.TrimSpace(os.Getenv("QWEN_HOME"))
	if qwenHome == "" {
		qwenHome = filepath.Join(home, ".qwen")
	}
	return filepath.Join(qwenHome, "settings.json")
}

// loadQwenConfiguredModels lists the models under modelProviders in Qwen Code's
// user settings. Qwen Code has no headless model catalog, so this is the daemon's
// non-network discovery. The same entries hold endpoints and credential variable
// names, and the result leaves the machine: only id and name may be copied.
func loadQwenConfiguredModels(home string) ([]agent.Model, error) {
	raw, err := os.ReadFile(qwenUserSettingsPath(home))
	if os.IsNotExist(err) {
		return []agent.Model{}, nil
	}
	if err != nil {
		return nil, err
	}
	document, err := unmarshalRuntimeMcpConfig(raw, "jsonc")
	if err != nil {
		return nil, err
	}
	providers, ok := document["modelProviders"].(map[string]any)
	if !ok {
		return []agent.Model{}, nil
	}

	providerNames := make([]string, 0, len(providers))
	for name := range providers {
		providerNames = append(providerNames, name)
	}
	sort.Strings(providerNames)

	models := make([]agent.Model, 0)
	seen := make(map[string]struct{})
	for _, providerName := range providerNames {
		entries, ok := providers[providerName].([]any)
		if !ok {
			continue
		}
		for _, rawEntry := range entries {
			entry, ok := rawEntry.(map[string]any)
			if !ok {
				continue
			}
			id, _ := entry["id"].(string)
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			if _, duplicate := seen[id]; duplicate {
				continue
			}
			seen[id] = struct{}{}
			label, _ := entry["name"].(string)
			label = strings.TrimSpace(label)
			if label == "" {
				label = id
			}
			models = append(models, agent.Model{ID: id, Label: label})
		}
	}
	return models, nil
}
