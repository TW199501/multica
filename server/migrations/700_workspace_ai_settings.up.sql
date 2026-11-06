-- One row per workspace holding the admin-configured chat AI endpoint. The API
-- key is stored sealed (secretbox); only its last four characters are kept in
-- clear for display. No FK to workspace/user by design (workspace DB rules).
-- The primary key is built concurrently in 701/702, following
-- member_delegation_day (589-591).
CREATE TABLE IF NOT EXISTS workspace_ai_settings (
    workspace_id     UUID NOT NULL,
    provider         TEXT NOT NULL,
    base_url         TEXT NOT NULL,
    model            TEXT NOT NULL DEFAULT '',
    api_key_sealed   BYTEA,
    api_key_last4    TEXT NOT NULL DEFAULT '',
    disable_thinking BOOLEAN NOT NULL DEFAULT false,
    prompt           TEXT NOT NULL DEFAULT '',
    prompt_skill_id  UUID,
    last_called_at   TIMESTAMPTZ,
    updated_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
