package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/aisettings"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/llm"
)

const (
	polishMaxTextRunes        = 8000
	polishContextMessages     = 6
	polishContextMessageRunes = 800
	polishDescriptionRunes    = 2000
	// Upper bound on one thread's rows read from the database; only the newest
	// polishContextMessages of them are sent.
	polishThreadRowLimit = 500

	polishPlaceholderRule = "The draft contains placeholders of the form ⟦n⟧ that stand for " +
		"mentions, links and code. Keep every placeholder exactly once and unchanged, " +
		"and do not add new ones."
)

type polishContext struct {
	Kind            string `json:"kind"`
	ChatSessionID   string `json:"chat_session_id"`
	IssueID         string `json:"issue_id"`
	ThreadCommentID string `json:"thread_comment_id"`
}

type polishRequest struct {
	Text    string        `json:"text"`
	Context polishContext `json:"context"`
}

type polishTurn struct{ speaker, content string }

// errPolishNotFound marks a context source outside the caller's reach; the
// handler has already written the 404 when it is returned.
var errPolishNotFound = errors.New("polish context not found")

// truncatePolishRunes mirrors truncateChatQuickActionsRunes: head only.
func truncatePolishRunes(content string, maxRunes int) string {
	runes := []rune(content)
	if len(runes) <= maxRunes {
		return content
	}
	return string(runes[:maxRunes]) + "…"
}

// PolishText rewrites a member's draft with the workspace's own AI settings.
// Mentions, links and code are masked before sending and restored afterwards.
func (h *Handler) PolishText(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	userID := requestUserID(r)
	var req polishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	if utf8.RuneCountInString(req.Text) > polishMaxTextRunes {
		writeError(w, http.StatusBadRequest, "text is too long")
		return
	}
	switch req.Context.Kind {
	case "chat", "issue", "none":
	default:
		writeError(w, http.StatusBadRequest, "unknown context kind")
		return
	}

	if !h.aiSettingsKeyAvailable() {
		writeError(w, http.StatusConflict, "ai_not_configured")
		return
	}
	client, settings, err := h.AISettings.ClientFor(r.Context(), workspaceID)
	switch {
	case errors.Is(err, aisettings.ErrNotConfigured), errors.Is(err, aisettings.ErrSecretKeyMissing):
		writeError(w, http.StatusConflict, "ai_not_configured")
		return
	case err != nil:
		slog.Error("ai polish: load settings failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to polish text")
		return
	}

	header, turns, err := h.polishContextTurns(r.Context(), w, workspaceID, userID, req.Context)
	if errors.Is(err, errPolishNotFound) {
		return
	}
	if err != nil {
		slog.Error("ai polish: load context failed", "kind", req.Context.Kind, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to polish text")
		return
	}
	systemPrompt, err := h.polishSystemPrompt(r.Context(), workspaceID, settings)
	if err != nil {
		slog.Error("ai polish: load prompt skill failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to polish text")
		return
	}

	masked, spans := aisettings.Protect(req.Text)
	out, err := client.GenerateText(r.Context(), settings.Model, systemPrompt, renderPolishPrompt(header, turns, masked))
	if err != nil {
		status, _, isUpstream := llm.UpstreamError(err)
		if !isUpstream {
			status = 0
		}
		// The error text can embed the base URL, so only the status is logged.
		slog.Warn("ai polish: upstream failed", "status", status)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "upstream_failed", "status": status})
		return
	}
	out = strings.TrimSpace(out)
	if out == "" {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "upstream_failed", "status": 0})
		return
	}
	polished, err := aisettings.Restore(out, spans)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "polish_lost_spans")
		return
	}
	if err := h.AISettings.TouchCalled(r.Context(), workspaceID); err != nil {
		slog.Warn("ai polish: touch last_called_at failed", "error", err)
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": polished})
}

func (h *Handler) polishSystemPrompt(ctx context.Context, workspaceID pgtype.UUID, s aisettings.Settings) (string, error) {
	base := ""
	if s.PromptSkillID.Valid {
		skill, err := h.Queries.GetSkillInWorkspace(ctx, db.GetSkillInWorkspaceParams{ID: s.PromptSkillID, WorkspaceID: workspaceID})
		switch {
		case err == nil:
			base = strings.TrimSpace(skill.Content)
		case !errors.Is(err, pgx.ErrNoRows):
			return "", err
		}
	}
	if base == "" {
		base = strings.TrimSpace(s.Prompt)
	}
	if base == "" {
		base = aisettings.DefaultPrompt()
	}
	return base + "\n\n" + polishPlaceholderRule, nil
}

// polishContextTurns loads the conversation the draft answers. On a missing or
// foreign source it writes the 404 (or 400 for a malformed id) and returns
// errPolishNotFound.
func (h *Handler) polishContextTurns(ctx context.Context, w http.ResponseWriter, workspaceID pgtype.UUID, userID string, pc polishContext) (string, []polishTurn, error) {
	switch pc.Kind {
	case "chat":
		return h.polishChatTurns(ctx, w, workspaceID, userID, pc.ChatSessionID)
	case "issue":
		return h.polishIssueTurns(ctx, w, workspaceID, pc.IssueID, pc.ThreadCommentID)
	}
	return "", nil, nil
}

func (h *Handler) polishChatTurns(ctx context.Context, w http.ResponseWriter, workspaceID pgtype.UUID, userID, rawID string) (string, []polishTurn, error) {
	sessionID, ok := parseUUIDOrBadRequest(w, rawID, "chat_session_id")
	if !ok {
		return "", nil, errPolishNotFound
	}
	session, err := h.Queries.GetChatSessionInWorkspace(ctx, db.GetChatSessionInWorkspaceParams{ID: sessionID, WorkspaceID: workspaceID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && uuidToString(session.CreatorID) != userID) {
		writeError(w, http.StatusNotFound, "chat session not found")
		return "", nil, errPolishNotFound
	}
	if err != nil {
		return "", nil, err
	}
	msgs, err := h.Queries.ListChatMessagesPage(ctx, db.ListChatMessagesPageParams{ChatSessionID: session.ID, Limit: polishContextMessages})
	if err != nil {
		return "", nil, err
	}
	turns := make([]polishTurn, 0, len(msgs))
	// The page is newest first; the prompt reads oldest first.
	for i := len(msgs) - 1; i >= 0; i-- {
		speaker := "agent"
		if msgs[i].Role == "user" {
			speaker = "user"
		}
		turns = appendPolishTurn(turns, speaker, msgs[i].Content)
	}
	return "", turns, nil
}

func (h *Handler) polishIssueTurns(ctx context.Context, w http.ResponseWriter, workspaceID pgtype.UUID, rawIssueID, rawThreadID string) (string, []polishTurn, error) {
	issueID, ok := parseUUIDOrBadRequest(w, rawIssueID, "issue_id")
	if !ok {
		return "", nil, errPolishNotFound
	}
	issue, err := h.Queries.GetIssueInWorkspace(ctx, db.GetIssueInWorkspaceParams{ID: issueID, WorkspaceID: workspaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "issue not found")
		return "", nil, errPolishNotFound
	}
	if err != nil {
		return "", nil, err
	}
	header := "ISSUE TITLE: " + strings.TrimSpace(issue.Title) + "\n"
	if d := strings.TrimSpace(issue.Description.String); d != "" {
		header += "ISSUE DESCRIPTION: " + truncatePolishRunes(d, polishDescriptionRunes) + "\n"
	}

	var turns []polishTurn
	if strings.TrimSpace(rawThreadID) == "" {
		comments, err := h.Queries.ListCommentsForIssue(ctx, db.ListCommentsForIssueParams{IssueID: issue.ID, WorkspaceID: workspaceID, Limit: polishContextMessages})
		if err != nil {
			return "", nil, err
		}
		for _, c := range comments {
			if !c.DeletedAt.Valid {
				turns = appendPolishTurn(turns, c.AuthorType, c.Content)
			}
		}
		return header, turns, nil
	}

	commentID, ok := parseUUIDOrBadRequest(w, rawThreadID, "thread_comment_id")
	if !ok {
		return "", nil, errPolishNotFound
	}
	root, err := h.Queries.GetThreadRoot(ctx, db.GetThreadRootParams{CommentID: commentID, WorkspaceID: workspaceID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && root.IssueID != issue.ID) {
		writeError(w, http.StatusNotFound, "comment not found")
		return "", nil, errPolishNotFound
	}
	if err != nil {
		return "", nil, err
	}
	rows, err := h.Queries.ListCommentThreadHistory(ctx, db.ListCommentThreadHistoryParams{
		RowLimit:        polishThreadRowLimit,
		RootID:          root.ID,
		WorkspaceID:     workspaceID,
		IssueID:         issue.ID,
		AnchorCreatedAt: pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true},
		AnchorID:        root.ID,
	})
	if err != nil {
		return "", nil, err
	}
	for _, c := range rows {
		if !c.DeletedAt.Valid {
			turns = appendPolishTurn(turns, c.AuthorType, c.Content)
		}
	}
	if len(turns) > polishContextMessages {
		turns = turns[len(turns)-polishContextMessages:]
	}
	return header, turns, nil
}

func appendPolishTurn(turns []polishTurn, speaker, content string) []polishTurn {
	content = strings.TrimSpace(content)
	if content == "" {
		return turns
	}
	return append(turns, polishTurn{speaker: speaker, content: truncatePolishRunes(content, polishContextMessageRunes)})
}

func renderPolishPrompt(header string, turns []polishTurn, masked string) string {
	var b strings.Builder
	b.WriteString(header)
	if len(turns) > 0 {
		b.WriteString("CONVERSATION (oldest first, for context only; do not polish it):\n")
		for _, t := range turns {
			fmt.Fprintf(&b, "[%s]: %s\n", t.speaker, t.content)
		}
	}
	if b.Len() > 0 {
		b.WriteString("\n")
	}
	b.WriteString("DRAFT TO POLISH:\n")
	b.WriteString(masked)
	return b.String()
}
