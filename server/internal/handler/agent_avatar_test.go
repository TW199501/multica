package handler

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestPickAgentAvatarUsesEveryBundledImageBeforeRepeating(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "packages", "ui", "assets", "personas")
	files, err := filepath.Glob(filepath.Join(dir, "*.svg"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != agentPersonaAvatarCount {
		t.Fatalf("found %d images, agentPersonaAvatarCount is %d", len(files), agentPersonaAvatarCount)
	}
	used := make(map[string]struct{})
	for i := 0; i < agentPersonaAvatarCount; i++ {
		avatar := pickAgentAvatar(used)
		if _, repeated := used[avatar]; repeated {
			t.Fatalf("pick %d repeated %q", i, avatar)
		}
		var number int
		if _, err := fmt.Sscanf(avatar, agentPersonaAvatarPrefix+"%02d", &number); err != nil {
			t.Fatalf("avatar %q: %v", avatar, err)
		}
		if _, err := os.Stat(filepath.Join(dir, fmt.Sprintf("%02d.svg", number))); err != nil {
			t.Fatalf("avatar %q has no image: %v", avatar, err)
		}
		used[avatar] = struct{}{}
	}
	if avatar := pickAgentAvatar(used); avatar == "" {
		t.Fatal("expected a repeat once every image is taken")
	}
}
