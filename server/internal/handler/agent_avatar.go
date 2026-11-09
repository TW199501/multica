package handler

import (
	"crypto/rand"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	agentEmojiAvatarPrefix   = "emoji:"
	agentPersonaAvatarPrefix = "persona:"
	// agentPersonaAvatarCount is the number of images in packages/ui/assets/personas.
	agentPersonaAvatarCount = 24
)

// pickAgentAvatar returns a random person avatar nobody in used has yet, so
// agents in a workspace look different until every image is taken.
func pickAgentAvatar(used map[string]struct{}) string {
	free := make([]string, 0, agentPersonaAvatarCount)
	for number := 1; number <= agentPersonaAvatarCount; number++ {
		avatar := fmt.Sprintf("%s%02d", agentPersonaAvatarPrefix, number)
		if _, taken := used[avatar]; !taken {
			free = append(free, avatar)
		}
	}
	if len(free) == 0 {
		for number := 1; number <= agentPersonaAvatarCount; number++ {
			free = append(free, fmt.Sprintf("%s%02d", agentPersonaAvatarPrefix, number))
		}
	}
	index, err := rand.Int(rand.Reader, big.NewInt(int64(len(free))))
	if err != nil {
		return free[0]
	}
	return free[index.Int64()]
}

// newAgentAvatar resolves the avatar to persist for a newly created agent. An
// explicit value is validated through acceptAvatarURL — a create path is still
// a way to publish a storage object, so it carries the same authorization
// boundary as an update. ok=false means the error response is already written
// and the caller must abort.
func (h *Handler) newAgentAvatar(w http.ResponseWriter, r *http.Request, workspaceID pgtype.UUID, avatarURL *string) (pgtype.Text, bool) {
	if avatarURL != nil && strings.TrimSpace(*avatarURL) != "" {
		accepted, ok := h.acceptAvatarURL(w, r, *avatarURL, "")
		if !ok {
			return pgtype.Text{}, false
		}
		return pgtype.Text{String: accepted, Valid: true}, true
	}
	used := make(map[string]struct{})
	agents, err := h.Queries.ListAllAgents(r.Context(), workspaceID)
	if err != nil {
		// A repeated face is not worth failing the create over.
		slog.Warn("list agents for avatar failed", "error", err)
	}
	for _, agent := range agents {
		used[agent.AvatarUrl.String] = struct{}{}
	}
	return pgtype.Text{String: pickAgentAvatar(used), Valid: true}, true
}
