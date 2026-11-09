package handler

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestRandomAgentAvatarStaysWithinTheBundledImages(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "packages", "ui", "assets", "personas", "*.svg"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != agentPersonaAvatarCount {
		t.Fatalf("found %d images, agentPersonaAvatarCount is %d", len(files), agentPersonaAvatarCount)
	}
	for i := 0; i < 500; i++ {
		avatar := randomAgentAvatar()
		var number int
		if _, err := fmt.Sscanf(avatar, agentPersonaAvatarPrefix+"%02d", &number); err != nil {
			t.Fatalf("avatar %q: %v", avatar, err)
		}
		image := filepath.Join("..", "..", "..", "packages", "ui", "assets", "personas", fmt.Sprintf("%02d.svg", number))
		if _, err := os.Stat(image); err != nil {
			t.Fatalf("avatar %q has no image: %v", avatar, err)
		}
	}
}
