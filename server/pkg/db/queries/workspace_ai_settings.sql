-- name: GetWorkspaceAISettings :one
SELECT * FROM workspace_ai_settings
WHERE workspace_id = $1;

-- name: UpsertWorkspaceAISettings :one
-- api_key_sealed / api_key_last4 are only overwritten when a new sealed key is
-- supplied, so saving without a key keeps the stored one; clear_key wipes it
-- (a new key in the same call wins, so callers pass clear_key=false then).
-- expected_updated_at makes keeping a key conditional on the row the caller
-- checked it against: no row comes back when another save got there first.
INSERT INTO workspace_ai_settings (
    workspace_id, provider, base_url, model, api_key_sealed, api_key_last4,
    disable_thinking, prompt, prompt_skill_id, updated_by
) VALUES (
    $1, $2, $3, $4, sqlc.narg('api_key_sealed'), sqlc.arg('api_key_last4'),
    $5, $6, $7, $8
)
ON CONFLICT (workspace_id) DO UPDATE SET
    provider         = EXCLUDED.provider,
    base_url         = EXCLUDED.base_url,
    model            = EXCLUDED.model,
    api_key_sealed   = CASE WHEN sqlc.arg('clear_key')::boolean THEN NULL
                            ELSE COALESCE(EXCLUDED.api_key_sealed, workspace_ai_settings.api_key_sealed) END,
    api_key_last4    = CASE WHEN sqlc.arg('clear_key')::boolean THEN ''
                            WHEN EXCLUDED.api_key_sealed IS NULL THEN workspace_ai_settings.api_key_last4
                            ELSE EXCLUDED.api_key_last4 END,
    disable_thinking = EXCLUDED.disable_thinking,
    prompt           = EXCLUDED.prompt,
    prompt_skill_id  = EXCLUDED.prompt_skill_id,
    updated_by       = EXCLUDED.updated_by,
    updated_at       = now()
WHERE sqlc.narg('expected_updated_at')::timestamptz IS NULL
   OR workspace_ai_settings.updated_at = sqlc.narg('expected_updated_at')
RETURNING *;

-- name: TouchWorkspaceAISettingsCalledAt :exec
UPDATE workspace_ai_settings SET last_called_at = now()
WHERE workspace_id = $1;
