# E-50 AI 設定與對話優化（前後端） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作區管理員在「AI 設定」頁設定、測試、加密儲存一組「對話 AI」；任何成員在六個輸入框按「對話優化」，看左右對照、可重新產生、採用後才換進輸入框；附可選的 llama.cpp 部署套件。

**Architecture:** 新增 `server/internal/aisettings` 套件，負責資料表讀寫、金鑰加解密（`secretbox`，主金鑰 `MULTICA_AI_SECRET_KEY`）與依工作區設定建出 `*llm.Client`。Handler 只做權限、解析與回應；所有模型呼叫照舊經過 `server/pkg/llm`。對話優化在送出前把 @提及、連結、行內程式碼換成佔位符，回來後還原，佔位符少了就整次失敗，不把壞掉的文字交給使用者。

前端：`packages/core` 加 API 方法、zod schema、Query hooks；`packages/views` 加共用的 AI 設定頁與對話優化按鈕／對照視窗，網頁版與桌面版各自接路由；六個輸入框共用同一組按鈕與視窗，用編輯器的 `getMarkdown()` 讀、`adoptContent()` 換。

**Tech Stack:** Go（Chi、sqlc、pgx）、PostgreSQL、`server/pkg/llm`（OpenAI Go SDK）、`server/internal/util/secretbox`、Docker Compose（llama.cpp `llama-server`）；TypeScript、React、TanStack Query、zod、Base UI（`@multica/ui`）、react-i18next、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-03-ai-settings-and-message-polish-design.md`（Multica E-49）。原本的前端計畫 E-51 已併入本計畫（Eddie 2026-11-03 同意）。參考畫面在 `docs/superpowers/specs/images/ai-settings/`。

## Global Constraints

- 伺服器呼叫模型一律經過 `server/pkg/llm`；`pkg/llm` 以外不得 import `github.com/openai/openai-go`。新增呼叫要更新 `server/pkg/llm/client.go` 開頭的「Consumers」清單，以及 `.env.example` 與 `apps/docs/content/docs/environment-variables*.mdx` 對外說明送出哪些內容的文字。
- 不加外鍵、不做級聯刪除。每個建立索引的 migration 用 `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS`，一個檔案只有一個陳述式。
- 資料庫腳本必須冪等、可重複執行（`IF NOT EXISTS`／`IF EXISTS`），不可 DROP 既有資料表或資料；down migration 只刪本計畫新建的物件。
- 工作區設定與 `MULTICA_LLM_*` 不互相替代：工作區沒設定時對話優化回錯誤，不退回環境變數那組；聊天標題、建議追問不改。
- 任何 API 回應、日誌、錯誤訊息都不得出現完整金鑰；日誌也不記 base URL（自架網址常帶 token）。
- 「測試」失敗只回 HTTP 狀態碼與截短到 200 個字元的訊息，訊息中出現的金鑰字串要換成 `***`。
- 端點可以是內網位址或 localhost（Eddie 決定），不經過外連防護的阻擋清單。
- 換供應商或改了端點的主機，必須重新輸入金鑰，儲存與測試都一樣。
- Handler 內 UUID 處理照 AGENTS.md：純 UUID 輸入用 `parseUUIDOrBadRequest`；查詢一律帶 `workspace_id`。
- 程式碼註解用英文，只寫不明顯的理由與限制。commit 訊息 `feat(E-50): …`／`docs(E-50): …`，結尾附 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不在計畫範圍內的檔案不修改；不刪測試、不放寬斷言。
- 前端：UI 讀到的 JSON 一律經 zod schema 與 `parseWithFallback`（`packages/core/api/schema.ts:38`），新 endpoint 補格式錯誤測試；`packages/core` 不用 UI 函式庫；`packages/views` 不定義 store、不用 `next/*`／`react-router-dom`，導覽用 `useNavigation()`；圖示只從 `@multica/ui/icons` 取（用 `Sparkles`）；文字大小用 `--text-*` 語意 token；按鈕與對話框照 `packages/ui/docs/button.md`、`dialog.md`。
- 文案補齊六種語系（`en`、`fr`、`ja`、`ko`、`zh-Hans`、`zh-Hant`），照 `apps/docs/content/docs/developers/conventions.zh.mdx` 檢查；說明文字預設不寫，只在不明顯的限制處寫（例：沒設主金鑰、換主機要重填金鑰）。
- 本單無 `.ps1`。
- 發版由 Eddie 執行（快轉 `release`）；本計畫只開 PR 進 `dev`，AI 不合併、不推 `dev`／`release`／`main`。

## Review Focus

1. **模型把 @提及、連結或程式碼改掉或刪掉**：使用者預期這些原樣保留、還能點。→ Task 4 的 `TestPolishRestoresProtectedSpans`、`TestPolishFailsWhenModelDropsPlaceholder`。
2. **上游錯誤訊息把金鑰原文帶回來**（OpenAI 401 會回「Incorrect API key provided: sk-…」）：使用者預期畫面上看不到金鑰。→ Task 3 的 `TestAISettingsTestRedactsKeyInUpstreamError`。
3. **改了端點主機卻沿用舊金鑰**：使用者預期已存的金鑰不會被送到新網址。→ Task 2 的 `TestAISettingsSaveRequiresKeyWhenHostChanges`、Task 3 的 `TestAISettingsTestRequiresKeyWhenHostChanges`。
4. **沒設主金鑰、一般成員、別人的聊天**：沒設 `MULTICA_AI_SECRET_KEY` 時頁面能開但不能存、按鈕不出現、沒有外送；一般成員讀寫設定被擋、看不到入口；用別人的聊天當前文要 404。→ Task 2 的 `TestAISettingsWithoutSecretKey`、`TestAISettingsRequiresAdmin`，Task 4 的 `TestPolishUnavailableMakesNoUpstreamRequest`、`TestPolishRejectsForeignChatSession`，Task 7 的 `hides the entry for members`、`shows the secret-key notice and disables save`。
5. **採用後草稿沒同步**：`adoptContent()` 不觸發 `onUpdate`，若不另外同步草稿，建立任務送出的仍是舊描述、重新整理後草稿回到舊文字。使用者預期採用的文字就是送出的文字。→ Task 8 的 `chat sends the adopted text`，Task 9 的 `create-issue submits the adopted description`、`quick-create keeps the adopted prompt`。

---

## 檔案結構

- 新增 `server/migrations/<N>_workspace_ai_settings.up.sql`／`.down.sql`：建表。
- 新增 `server/migrations/<N+1>_workspace_ai_settings_workspace_uidx.up.sql`／`.down.sql`：並行建唯一索引。
- 新增 `server/migrations/<N+2>_workspace_ai_settings_primary_key.up.sql`／`.down.sql`：用該索引當主鍵。
  - `<N>` 取實作當下 `server/migrations/` 最大編號加一（目前最大 594；同步上游後可能變）。
- 新增 `server/pkg/db/queries/workspace_ai_settings.sql`，`make sqlc` 重新產生 `server/pkg/db/generated/`。
- 新增 `server/internal/aisettings/aisettings.go`、`aisettings_test.go`：設定讀寫、金鑰、建 client。
- 新增 `server/internal/aisettings/protect.go`、`protect_test.go`：佔位符保護。
- 修改 `server/pkg/llm/client.go`：新增 `UpstreamError`、更新 Consumers 註解。新增 `server/pkg/llm/upstream_error_test.go`。
- 新增 `server/internal/handler/ai_settings.go`、`ai_settings_test.go`：設定、測試、狀態 API。
- 新增 `server/internal/handler/ai_polish.go`、`ai_polish_test.go`：對話優化 API。
- 修改 `server/internal/handler/handler.go`：`Handler` 加 `AISettings *aisettings.Service` 欄位。
- 修改 `server/cmd/server/router.go`：讀 `MULTICA_AI_SECRET_KEY`、建 service、註冊路由。
- 新增 `deploy/llama/docker-compose.yml`、`deploy/llama/README.md`。
- 修改 `.env.example`、`docker-compose.selfhost.yml`、`docker-compose.dockhand.yml`、`apps/docs/content/docs/environment-variables{,.fr,.ja,.ko,.zh,.zh-Hant}.mdx`。
- 修改 `packages/core/api/client.ts`、`packages/core/api/schemas.ts`、`packages/core/types/workspace.ts`（與 `types/index.ts` 匯出）、`packages/core/workspace/queries.ts`、`packages/core/workspace/mutations.ts`、`packages/core/paths/paths.ts`；測試 `packages/core/api/client.test.ts`、`packages/core/workspace/mutations.test.tsx`。
- 新增 `packages/views/agents/ai-settings/ai-settings-page.tsx`、`provider-presets.ts`、`ai-settings-page.test.tsx`；修改 `packages/views/agents/components/agents-page.tsx`（入口按鈕）、`packages/views/package.json`（子路徑匯出）。
- 新增 `apps/web/app/[workspaceSlug]/(dashboard)/agents/ai-settings/page.tsx`；修改 `apps/desktop/src/renderer/src/routes.tsx`（需要時加 `pages/ai-settings-page.tsx` 設標題）。
- 新增 `packages/views/editor/polish/polish-button.tsx`、`polish-dialog.tsx`、`use-polish.ts`、`polish.test.tsx`；修改六個輸入框：`packages/views/chat/components/chat-input.tsx`、`packages/views/issues/components/comment-input.tsx`、`reply-input.tsx`、`comment-card.tsx`、`packages/views/modals/create-issue.tsx`、`quick-create-issue.tsx`。
- 修改六種語系的 `packages/views/locales/<locale>/agents.json`、`editor.json`、`settings.json`。
- 修改 `packages/core/issues/stores/comment-composer-store.ts`、`packages/views/settings/components/preferences-tab.tsx`；新增 `packages/views/editor/polish/use-polish-gate.ts`。

## 驗證環境

- DB 相關測試需要本 worktree 的環境：`make up`（Windows 下若 `make up` 把 API 停掉，照 CONTRIBUTING 手動起資料庫即可，測試只需要資料庫）。
- 單一套件測試：`make env-exec ARGS="-- bash -c 'cd server && go test ./internal/aisettings/... -count=1'"`；handler 測試把路徑換成 `./internal/handler -run '<名稱>'`。
- 前端單檔測試：`pnpm --filter @multica/core exec vitest run <路徑>`、`pnpm --filter @multica/views exec vitest run <路徑>`。
- 收尾：`make test`、`pnpm typecheck`、`pnpm lint`、`pnpm test`。

---

## Task 1：資料表、查詢與 `aisettings` 套件

**Files:**
- Create: 上述三組 migration、`server/pkg/db/queries/workspace_ai_settings.sql`
- Create: `server/internal/aisettings/aisettings.go`
- Test: `server/internal/aisettings/aisettings_test.go`

**Interfaces:**
- Consumes: `secretbox.Box`（`Seal`／`Open`）、`db.Queries`、`llm.New`／`llm.Config`。
- Produces（後面 Task 都用這些名字）：

```go
package aisettings

var (
    ErrSecretKeyMissing = errors.New("aisettings: MULTICA_AI_SECRET_KEY is not set")
    ErrNotConfigured    = errors.New("aisettings: workspace AI is not configured")
    ErrKeyRequired      = errors.New("aisettings: api key must be re-entered for a new provider or host")
)

type Settings struct {
    Provider        string
    BaseURL         string
    Model           string
    DisableThinking bool
    Prompt          string
    PromptSkillID   pgtype.UUID
    APIKeySet       bool
    APIKeyLast4     string
    LastCalledAt    pgtype.Timestamptz
}

// Input is what an admin submits. APIKey nil = keep the stored key.
type Input struct {
    Provider, BaseURL, Model, Prompt string
    DisableThinking                  bool
    PromptSkillID                    pgtype.UUID
    APIKey                           *string
}

type Service struct { /* queries, box (may be nil) */ }

func NewService(q *db.Queries, box *secretbox.Box) *Service
func (s *Service) SecretKeyAvailable() bool
func (s *Service) Get(ctx context.Context, workspaceID pgtype.UUID) (Settings, bool, error) // bool = row exists
func (s *Service) Save(ctx context.Context, workspaceID, userID pgtype.UUID, in Input) (Settings, error)
// ResolveKey returns the key to use for in: the new one, or the stored one when
// provider and host are unchanged. ErrKeyRequired otherwise (when a key was stored).
func (s *Service) ResolveKey(ctx context.Context, workspaceID pgtype.UUID, in Input) (string, error)
func (s *Service) ClientFor(ctx context.Context, workspaceID pgtype.UUID) (*llm.Client, Settings, error)
func (s *Service) TouchCalled(ctx context.Context, workspaceID pgtype.UUID) error
func ClientFromInput(in Input, apiKey string) *llm.Client
func DefaultPrompt() string
```

資料表 `workspace_ai_settings` 欄位：`workspace_id UUID NOT NULL`、`provider TEXT NOT NULL`、`base_url TEXT NOT NULL`、`model TEXT NOT NULL DEFAULT ''`、`api_key_sealed BYTEA`、`api_key_last4 TEXT NOT NULL DEFAULT ''`、`disable_thinking BOOLEAN NOT NULL DEFAULT false`、`prompt TEXT NOT NULL DEFAULT ''`、`prompt_skill_id UUID`、`last_called_at TIMESTAMPTZ`、`updated_by UUID`、`created_at`／`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`。唯一索引名 `workspace_ai_settings_workspace_uidx`，主鍵 `workspace_ai_settings_pkey`（寫法照 590／591）。

查詢：`GetWorkspaceAISettings :one`、`UpsertWorkspaceAISettings :one`（`ON CONFLICT (workspace_id) DO UPDATE`）、`TouchWorkspaceAISettingsCalledAt :exec`。

- [ ] 步驟 1.1：寫失敗測試 `aisettings_test.go`（DB-backed，用 `testutil` 建工作區與成員）：
  - `TestSaveSealsKeyAndReportsLast4`：`Save` 帶 `APIKey="sk-abcdef1234"` 後，`Get` 回 `APIKeySet=true`、`APIKeyLast4="1234"`；直接查 `api_key_sealed` 不含 `sk-abcdef1234` 位元組。
  - `TestSaveKeepsKeyWhenOmitted`：先存金鑰，再以 `APIKey=nil`、同 provider 同 host 改 model；`ResolveKey` 回原金鑰。
  - `TestSaveRequiresKeyOnProviderOrHostChange`：已存金鑰後，改 `Provider` 或把 `BaseURL` 的主機從 `api.openai.com` 改成 `evil.example`、`APIKey=nil`，`Save` 回 `ErrKeyRequired`；只改路徑（`/v1`→`/v2`）不算換主機。
  - `TestSaveWithoutBoxFails`：`NewService(q, nil)` 的 `Save` 回 `ErrSecretKeyMissing`，`SecretKeyAvailable()==false`。
  - `TestClientForUnconfigured`：沒有資料列時 `ClientFor` 回 `ErrNotConfigured`。
  - `TestSelfHostedKeylessIsConfigured`：`Provider="llamacpp"`、`BaseURL="http://localhost:8080/v1"`、無金鑰，`ClientFor` 回啟用的 client。
- [ ] 步驟 1.2：執行，確認因套件不存在而失敗：`make env-exec ARGS="-- bash -c 'cd server && go test ./internal/aisettings/... -count=1'"`。
- [ ] 步驟 1.3：寫 migrations 與查詢檔，`make sqlc`；實作 `aisettings.go`。主機比較用 `url.Parse` 後的 `Hostname()`＋`Port()`，大小寫不分。`DefaultPrompt()` 回英文系統提示：修錯字、把意思講清楚、不改原意、不加內容、用原文的語言、只輸出改好的文字、佔位符 `⟦n⟧` 原樣保留。
- [ ] 步驟 1.4：重跑步驟 1.2 的指令，全部通過；`make migrate-up` 對空資料庫跑兩次都成功。
- [ ] 步驟 1.5：commit `feat(E-50): store workspace AI settings with a sealed key`。

## Task 2：設定 API 與路由

**Files:**
- Create: `server/internal/handler/ai_settings.go`
- Modify: `server/internal/handler/handler.go`（`AISettings *aisettings.Service`）、`server/cmd/server/router.go`
- Test: `server/internal/handler/ai_settings_test.go`

**Interfaces:**
- Consumes: Task 1 的 `Service`。
- Produces（前端 E-51 依這份契約寫 zod schema）：
  - `GET /api/workspaces/{id}/ai-settings`（owner/admin）→ `200 {"secret_key_available":bool,"configured":bool,"provider":string,"base_url":string,"model":string,"disable_thinking":bool,"prompt":string,"default_prompt":string,"prompt_skill_id":string|null,"api_key_set":bool,"api_key_last4":string,"last_called_at":string|null}`。
  - `PUT /api/workspaces/{id}/ai-settings`（owner/admin），body `{"provider","base_url","model","disable_thinking","prompt","prompt_skill_id","api_key"?}`（`api_key` 省略＝不改）→ 同上的回應；`409 {"error":"api_key_required"}`；`503 {"error":"secret_key_missing"}`；`400` 給 `provider` 不在清單內（`claude`、`openai`、`gemini`、`deepseek`、`qwen`、`kimi`、`grok`、`openrouter`、`huggingface`、`llamacpp`、`custom`）、`base_url` 不是 http(s) 網址、`prompt_skill_id` 不屬於此工作區。
  - `GET /api/workspaces/{id}/ai-settings/status`（任何成員）→ `200 {"polish_available":bool}`，條件是有主金鑰且已設定。
- 路由：前兩個放在 `RequireWorkspaceRoleFromURL(queries, "id", "owner", "admin")` 群組，`status` 放在 `RequireWorkspaceMemberFromURL` 群組（寫法照 router.go 的 Slack 區塊）。`router.go` 用 `secretbox.LoadKey("MULTICA_AI_SECRET_KEY")` 建 box，失敗時 box 為 nil，service 照樣建立；開機日誌只記 `ai settings enabled`／`secret key missing`。

- [ ] 步驟 2.1：寫失敗測試：
  - `TestAISettingsGetPutRoundTrip`：PUT 帶 `api_key:"sk-test-9876"` 回 200、`api_key_last4=="9876"`；回應 body 字串不含 `sk-test-9876`；GET 結果一致。
  - `TestAISettingsRequiresAdmin`：以 `dbfx.Member(..., "member")` 建的使用者呼叫 GET、PUT 都是 403；呼叫 `status` 是 200。
  - `TestAISettingsSaveRequiresKeyWhenHostChanges`：已存金鑰後 PUT 改 `base_url` 主機且不帶 `api_key` → 409 `api_key_required`，資料庫的 base_url 沒變。
  - `TestAISettingsWithoutSecretKey`：`AISettings` 用 nil box 時 GET 回 `secret_key_available:false`、PUT 回 503、`status` 回 `polish_available:false`。
  - `TestAISettingsRejectsForeignSkill`：`prompt_skill_id` 是別的工作區的技能 → 400。
  - `TestAISettingsRejectsUnknownProvider`：`provider:"foo"` → 400。
- [ ] 步驟 2.2：執行 `-run 'TestAISettings'`，確認失敗（路由／handler 不存在）。
- [ ] 步驟 2.3：實作 `GetAISettings`、`PutAISettings`、`GetAISettingsStatus` 與路由、Handler 欄位、router 接線。
- [ ] 步驟 2.4：重跑步驟 2.2，全部通過。
- [ ] 步驟 2.5：commit `feat(E-50): admin API for workspace AI settings`。

## Task 3：連線測試 API 與上游錯誤

**Files:**
- Modify: `server/pkg/llm/client.go`（新增 `UpstreamError`）
- Create: `server/pkg/llm/upstream_error_test.go`
- Modify: `server/internal/handler/ai_settings.go`
- Test: `server/internal/handler/ai_settings_test.go`

**Interfaces:**
- Produces in `pkg/llm`：`func UpstreamError(err error) (status int, message string, ok bool)`，用 `errors.As` 取 `*openai.Error` 的 HTTP 狀態與訊息；不是上游錯誤時 `ok=false`。
- Produces API：`POST /api/workspaces/{id}/ai-settings/test`（owner/admin），body 同 PUT（未儲存的值）→ `200 {"ok":true}`；`200 {"ok":false,"status":int,"message":string}`（上游失敗，`status` 為 0 代表連不上）；`409 api_key_required`（規則同 Task 1 `ResolveKey`）。逾時 20 秒，`MaxRetries` 用 `llm.Retries(0)`。成功不寫 `last_called_at`（還沒儲存）。

- [ ] 步驟 3.1：寫失敗測試：
  - `TestUpstreamErrorExtractsStatus`（`pkg/llm`）：對回 401 的 httptest 伺服器呼叫 `GenerateText`，`UpstreamError` 回 `(401, "<上游 message>", true)`；對 `context.Canceled` 回 `ok=false`。
  - `TestAISettingsTestSucceeds`：用 `stubLLMCompletion(t, 200, "ok")` 的 URL 當 `base_url`，回 `{"ok":true}`。
  - `TestAISettingsTestRedactsKeyInUpstreamError`：stub 回 401，message 內含送出的 `api_key`；回應 `ok:false`、`status:401`、message 不含金鑰而含 `***`，長度不超過 200 個字元。
  - `TestAISettingsTestRequiresKeyWhenHostChanges`：已存金鑰、body 換主機不帶金鑰 → 409，stub 收到 0 個請求。
- [ ] 步驟 3.2：執行 `go test ./pkg/llm -run TestUpstreamError` 與 handler `-run 'TestAISettingsTest'`，確認失敗。
- [ ] 步驟 3.3：實作 `UpstreamError` 與 `CheckAISettings` handler。
- [ ] 步驟 3.4：重跑步驟 3.2，全部通過；`go test ./pkg/llm/... -count=1` 全綠。
- [ ] 步驟 3.5：commit `feat(E-50): test workspace AI connection without saving`。

## Task 4：對話優化 API

**Files:**
- Create: `server/internal/aisettings/protect.go`、`protect_test.go`
- Create: `server/internal/handler/ai_polish.go`
- Test: `server/internal/handler/ai_polish_test.go`
- Modify: `server/pkg/llm/client.go`（Consumers 註解加入本呼叫）

**Interfaces:**
- Produces in `aisettings`：
  - `func Protect(text string) (masked string, spans []string)`：依序把 Markdown 連結 `[...](...)`（含 `mention://`）、裸網址 `https?://\S+`、行內程式碼 `` `...` ``、圍欄程式碼區塊換成 `⟦1⟧`、`⟦2⟧`…。
  - `func Restore(masked string, spans []string) (string, error)`：每個佔位符必須剛好出現一次，否則回 `ErrSpanLost`。
- Produces API：`POST /api/workspaces/{id}/ai/polish`（任何成員），body `{"text":string,"context":{"kind":"chat"|"issue"|"none","chat_session_id"?:string,"issue_id"?:string,"thread_comment_id"?:string}}` → `200 {"text":string}`；`409 {"error":"ai_not_configured"}`（含沒主金鑰）；`400` 空文字、超過 8000 字元、kind 未知；`404` 聊天或任務不在本工作區或聊天不屬於呼叫者；`422 {"error":"polish_lost_spans"}`；`502 {"error":"upstream_failed","status":int}`。
- 前文：`chat` 取該聊天最近 6 則訊息；`issue` 取標題、描述（截 2000 字元）與最近 6 則留言，有 `thread_comment_id` 時只取那一串；`none` 沒有前文。每則截 800 字元（沿用 `chat_quick_actions_generate.go` 的截法）。
- 系統提示：有 `prompt_skill_id` 就用該技能的內容（`GetSkillInWorkspace`），否則用設定的 `prompt`，空的話用 `DefaultPrompt()`；後面固定附上佔位符規則。成功後呼叫 `TouchCalled`。

- [ ] 步驟 4.1：寫失敗測試：
  - `TestProtectRoundTrip`（`protect_test.go`）：`"請 [@Ann](mention://agent/1) 看 https://x.y/z 跟 `a_b`"` 經 `Protect` 後不含原連結；`Restore(masked, spans)` 回原字串。
  - `TestRestoreFailsOnMissingOrDuplicate`：少一個或重複一個佔位符都回 `ErrSpanLost`。
  - `TestPolishRestoresProtectedSpans`：stub 回把 `⟦1⟧` 保留的改寫文字，回應的 `text` 含原 mention 連結原文。
  - `TestPolishFailsWhenModelDropsPlaceholder`：stub 回不含 `⟦1⟧` 的文字 → 422 `polish_lost_spans`。
  - `TestPolishUnavailableMakesNoUpstreamRequest`：未設定（或 nil box）→ 409，stub 收到 0 個請求。
  - `TestPolishRejectsForeignChatSession`：別的使用者的聊天 → 404，stub 收到 0 個請求。
  - `TestPolishIssueContextUsesThread`：stub 記錄收到的 user message，`thread_comment_id` 指定時只含該串留言內容、不含其他串。
- [ ] 步驟 4.2：執行 `go test ./internal/aisettings/... -run 'Protect|Restore'` 與 handler `-run 'TestPolish'`，確認失敗。
- [ ] 步驟 4.3：實作 `protect.go`、`PolishText` handler、路由（放在成員群組）、更新 `pkg/llm` Consumers 註解：「Message polish — server/internal/handler/ai_polish.go。用工作區自己的設定（不是 MULTICA_LLM_*）；送出使用者正在寫的文字（最多 8000 字元），以及最多 6 則前文，每則截 800 字元、任務描述截 2000 字元；連結與程式碼以佔位符取代後才送出。」
- [ ] 步驟 4.4：重跑步驟 4.2，全部通過。
- [ ] 步驟 4.5：commit `feat(E-50): polish a draft against its conversation`。

## Task 5：llama.cpp 套件、環境變數與文件

**Files:**
- Create: `deploy/llama/docker-compose.yml`、`deploy/llama/README.md`
- Modify: `.env.example`、`docker-compose.selfhost.yml`、`docker-compose.dockhand.yml`（在 `MULTICA_SLACK_SECRET_KEY` 旁加 `MULTICA_AI_SECRET_KEY: ${MULTICA_AI_SECRET_KEY:-}`）、`apps/docs/content/docs/environment-variables.mdx` 與 `.fr`、`.ja`、`.ko`、`.zh`、`.zh-Hant` 五個譯本

**Interfaces:**
- Consumes: Task 4 的 Consumers 文字（文件照它寫）。
- Produces：`deploy/llama/docker-compose.yml` 一個服務 `llama`，映像 `ghcr.io/ggml-org/llama.cpp:server`（實作時釘一個實際存在的版本 tag），對外 `8080`，掛載 `./models`，指令 `--host 0.0.0.0 --port 8080 -m /models/<模型檔>`；不含任何 Multica 服務。README 寫下載模型、啟動、在「AI 設定」選「自架（llama.cpp）」填 `http://<主機>:8080/v1`、勾「關閉思考」。

- [ ] 步驟 5.1：先寫檢查：`docker compose -f deploy/llama/docker-compose.yml config` 目前因檔案不存在而失敗。
- [ ] 步驟 5.2：執行步驟 5.1 的指令，確認失敗。
- [ ] 步驟 5.3：新增兩個檔案；`.env.example` 在 Slack 區塊旁加 `MULTICA_AI_SECRET_KEY=`，註解寫「base64 編碼的 32 位元組金鑰，用來加密工作區 AI 設定的金鑰；不設定時 AI 設定頁不能儲存、對話優化不可用」；六個 `environment-variables*.mdx` 在金鑰表格加一列，並在 assist layer 那段補「對話優化用工作區設定，不用 `MULTICA_LLM_*`」與送出內容說明。
- [ ] 步驟 5.4：`docker compose -f deploy/llama/docker-compose.yml config` 成功；`pnpm --filter docs build` 成功；`git diff --check` 無輸出。
- [ ] 步驟 5.5：commit `docs(E-50): optional llama.cpp package and AI secret key`。

## Task 6：前端 API、schema 與 Query hooks

**Files:**
- Modify: `packages/core/api/client.ts`、`packages/core/api/schemas.ts`、`packages/core/types/workspace.ts`、`packages/core/types/index.ts`、`packages/core/workspace/queries.ts`、`packages/core/workspace/mutations.ts`、`packages/core/paths/paths.ts`
- Test: `packages/core/api/client.test.ts`、`packages/core/workspace/mutations.test.tsx`

**Interfaces:**
- Consumes: Task 2–4 的 API 契約。
- Produces：
  - 型別 `WorkspaceAISettings`（欄位同 Task 2 回應）、`AISettingsInput`（`api_key?: string`）、`AISettingsTestResult = { ok: true } | { ok: false; status: number; message: string }`、`PolishContext = { kind: "chat"; chat_session_id: string } | { kind: "issue"; issue_id: string; thread_comment_id?: string } | { kind: "none" }`。
  - `ApiClient`：`getAISettings(wsId): Promise<WorkspaceAISettings>`、`updateAISettings(wsId, input: AISettingsInput): Promise<WorkspaceAISettings>`、`testAISettings(wsId, input: AISettingsInput): Promise<AISettingsTestResult>`、`getAISettingsStatus(wsId): Promise<{ polish_available: boolean }>`、`polishText(wsId, text: string, context: PolishContext): Promise<{ text: string }>`。寫法照 `listWorkspaceMcpServers`（client.ts:3103）。`409 api_key_required` 與 `422 polish_lost_spans` 以可辨識的錯誤碼往上丟，讓 UI 顯示對應文案。
  - schema：`WorkspaceAISettingsSchema`（缺欄位給預設、`provider` 未知值保留字串）、`AISettingsTestResultSchema`、`AISettingsStatusSchema`（解析失敗時 `polish_available:false`）、`PolishResultSchema`。
  - `workspaceKeys.aiSettings(wsId)`＝`["workspaces", wsId, "ai-settings"]`、`workspaceKeys.aiSettingsStatus(wsId)`＝`["workspaces", wsId, "ai-settings", "status"]`；`workspaceAISettingsOptions(wsId)`、`workspaceAISettingsStatusOptions(wsId)`；`useUpdateAISettings(wsId)`（成功後 invalidate 兩個 key）、`useTestAISettings(wsId)`、`usePolishText(wsId)`。
  - `paths.workspace(slug).agentAISettings()`＝`${ws}/agents/ai-settings`，比照現有 `newAgent()` 掛在 agents 底下，不新增頂層路徑段。

- [ ] 步驟 6.1：寫失敗測試：`client.test.ts` 加 `getAISettings falls back when the response is malformed`（回 `{ nope: true }` 時得到 `configured:false`、`secret_key_available:false`）、`getAISettingsStatus treats malformed as unavailable`、`polishText surfaces polish_lost_spans`；`mutations.test.tsx` 加 `useUpdateAISettings invalidates settings and status`。
- [ ] 步驟 6.2：`pnpm --filter @multica/core exec vitest run api/client.test.ts workspace/mutations.test.tsx`，確認失敗。
- [ ] 步驟 6.3：實作型別、schema、client 方法、queries、mutations、path。
- [ ] 步驟 6.4：重跑步驟 6.2 全部通過；`pnpm --filter @multica/core exec tsc --noEmit` 無錯誤。
- [ ] 步驟 6.5：commit `feat(E-50): client and hooks for workspace AI settings`。

## Task 7：「AI 設定」頁與入口

**Files:**
- Create: `packages/views/agents/ai-settings/ai-settings-page.tsx`、`provider-presets.ts`、`ai-settings-page.test.tsx`
- Modify: `packages/views/agents/components/agents-page.tsx`（`PageHeaderBar` 的 `actions`，約 271–277 行）、`packages/views/package.json`、`apps/web/app/[workspaceSlug]/(dashboard)/agents/ai-settings/page.tsx`（新增）、`apps/desktop/src/renderer/src/routes.tsx`、六種語系 `agents.json`

**Interfaces:**
- Consumes: Task 6 的 hooks、`useCurrentMember(wsId)`（`@multica/core/permissions`）、`useWorkspacePaths()`、`useNavigation()`、技能清單（現有 skills query）。
- Produces：`export function AISettingsPage()`（子路徑 `@multica/views/agents/ai-settings`）；`PROVIDER_PRESETS: { key: string; baseUrl: string; models: string[] }[]`，`key` 為 Task 2 的 11 個值，`llamacpp` 的 `baseUrl` 是 `http://localhost:8080/v1`、`custom` 是空字串，其餘填各家實際的 OpenAI 相容網址與常用模型（實作時查官方文件確認）。

頁面行為（照規格 A 節與 `docs/superpowers/specs/images/ai-settings/03-settings-mockup.png` 的版面，供應商改下拉）：
- 頁首：標題、連線狀態（「已連線 · N 分鐘前呼叫過」／「尚未設定」）。
- 欄位：供應商（Select，換了就帶入該家 `baseUrl` 與模型選項）、模型（可選可打字）、API 端點、API 金鑰（已存時顯示 `••••1234`，留空＝不改；換供應商或主機時欄位標成必填）、關閉思考（Switch）、提示詞（Textarea，空的時候顯示 `default_prompt` 當預設內容，旁邊「還原預設」）、從技能載入（Select 工作區技能，可清除）。
- 按鈕：「測試」用畫面上的值呼叫 `useTestAISettings`，顯示「連線成功」或狀態碼加訊息；「儲存」呼叫 `useUpdateAISettings`。`409 api_key_required` 時在金鑰欄位顯示錯誤。
- `secret_key_available:false` 時顯示「伺服器尚未設定加密金鑰」，停用儲存與測試。
- 非 owner/admin：入口按鈕不顯示；直接開網址時顯示沒有權限的提示（照 `SettingsReadOnlyNotice` 的做法），不呼叫設定 API。
- 入口：`agents-page.tsx` 的 `actions` 在「新建 AI 代理」左邊加一顆「AI 設定」，點擊 `navigation.push(paths.agentAISettings())`。
- 路由：網頁版新增 `agents/ai-settings/page.tsx`（`export { AISettingsPage as default } from "@multica/views/agents/ai-settings";`）；桌面版在 `routes.tsx` 的 `agents/:id` 之前加 `{ path: "agents/ai-settings", element: <AISettingsPage />, handle: { title: … } }`。

- [ ] 步驟 7.1：寫失敗測試 `ai-settings-page.test.tsx`（mock `@multica/core/api`）：`hides the entry for members`（member 角色時 agents 頁沒有「AI 設定」按鈕；owner 有）、`switching provider fills the endpoint`（選 llama.cpp 端點變成 `http://localhost:8080/v1`）、`shows last four digits and never the key`、`requires the key after a host change`（API 回 409 時金鑰欄位顯示錯誤）、`shows the secret-key notice and disables save`、`test shows status and message on failure`。
- [ ] 步驟 7.2：`pnpm --filter @multica/views exec vitest run agents/ai-settings`，確認失敗。
- [ ] 步驟 7.3：實作頁面、presets、入口、兩邊路由、六種語系文案（新 key 放在 `agents.json` 的 `ai_settings` 底下）。
- [ ] 步驟 7.4：重跑步驟 7.2 全部通過；`pnpm --filter @multica/views exec vitest run locales/parity.test.ts` 通過；`pnpm typecheck` 通過。
- [ ] 步驟 7.5：commit `feat(E-50): AI settings page for workspace admins`。

## Task 8：優化視窗與手動按鈕（聊天、留言、回覆）

**Files:**
- Create: `packages/views/editor/polish/polish-button.tsx`、`polish-dialog.tsx`、`use-polish.ts`、`polish.test.tsx`
- Modify: `packages/views/editor/index.ts`（匯出）、`packages/views/chat/components/chat-input.tsx`、`packages/views/issues/components/comment-input.tsx`、`packages/views/issues/components/reply-input.tsx`、六種語系 `editor.json`

**Interfaces:**
- Consumes: Task 6 的 `workspaceAISettingsStatusOptions`、`usePolishText`、`PolishContext`；`ContentEditorRef` 的 `getMarkdown()`、`adoptContent(markdown)`（`packages/views/editor/content-editor.tsx`）。
- Produces：
  - `usePolishAvailable(wsId: string): boolean`（status 查詢，未載入時 `false`）。
  - `PolishDialog(props: { open: boolean; mode: "adopt" | "send"; wsId: string; original: string; context: PolishContext; onClose: () => void; onConfirm: (markdown: string) => void | Promise<void> })`：
    - 標題列只有標題與 X；只有 X 會呼叫 `onClose`。Esc 與點視窗外面都不關閉（Base UI `onOpenChange` 對這兩種原因不處理）。
    - 背景遮罩不模糊；視窗置中，拖動標題列可以移動。
    - 左欄「優化前」唯讀；右欄「優化後」可編輯（純文字 Markdown 編輯，`Textarea` 即可）。
    - 開啟即呼叫一次 `usePolishText`；底部「優化」再呼叫一次並換掉右欄；第二顆按鈕 `mode="adopt"` 時是「採用」、`mode="send"` 時是「送出」，按下以右欄目前的文字呼叫 `onConfirm`。等待中第二顆按鈕停用。
    - 失敗時右欄放原文、上方顯示錯誤（`polish_lost_spans` 有專屬文案），仍可按「優化」或第二顆按鈕。
    - 底部說明「AI 代理可能會出錯。」；`mode="send"` 時再加「如果想自己決定要不要優化，請到偏好設定 → 評論與聊天，關閉對話優化。」
  - `PolishButton(props: { wsId: string; editorRef: RefObject<ContentEditorRef | null>; context: PolishContext; onAdopted?: (markdown: string) => void; disabled?: boolean })`：不可用時回 `null`；編輯器空白時停用；圖示 `Sparkles`，aria-label「對話優化」；開 `mode="adopt"` 的視窗，`onConfirm` 呼叫 `adoptContent`、`onAdopted`、關閉。
- 接法：按鈕放在各輸入框 `SubmitButton` 左邊。
  - 聊天：`context` 用 `activeSessionId`（`useChatStore`）；是 `DRAFT_NEW_SESSION` 或空值時用 `{ kind: "none" }`。
  - 留言：`{ kind: "issue", issue_id: issueId }`。
  - 回覆：`{ kind: "issue", issue_id: issueId, thread_comment_id: parentId }`。
  - 三個輸入框的草稿都由 `onAdopted` 寫回各自的草稿狀態（`adoptContent` 不觸發 `onUpdate`）。

- [ ] 步驟 8.1：寫失敗測試 `polish.test.tsx`：`renders nothing when polish is unavailable`、`is disabled for an empty editor`、`shows original and polished side by side`、`polish again replaces the right side`、`right side is editable and adopt uses the edited text`、`escape and outside click do not close`、`close button keeps the original`、`failure keeps the original on the right and shows the error`、`send mode shows the turn-off hint`、`chat sends the adopted text`（採用後按送出，`onSubmit` 收到的是優化後文字）、`reply passes the thread id`。
- [ ] 步驟 8.2：`pnpm --filter @multica/views exec vitest run editor/polish`，確認失敗。
- [ ] 步驟 8.3：實作三個檔案、接到三個輸入框、六種語系 `editor.json`（`polish` 底下）。
- [ ] 步驟 8.4：重跑步驟 8.2 全部通過；三個輸入框既有的測試（同目錄 `*.test.tsx`）照舊通過。
- [ ] 步驟 8.5：commit `feat(E-50): polish dialog and button in chat, comment and reply`。

## Task 9：其餘三個輸入框的手動按鈕

**Files:**
- Modify: `packages/views/issues/components/comment-card.tsx`（`CommentRow` 約 889 行、`CommentCardImpl` 約 1438 行的儲存按鈕旁）、`packages/views/modals/create-issue.tsx`（`createButton` 約 911 行）、`packages/views/modals/quick-create-issue.tsx`（`createButton` 約 617 行）
- Test: 各檔同目錄既有測試檔加案例

**Interfaces:**
- Consumes: Task 8 的 `PolishButton`。
- 接法：
  - 編輯留言：`{ kind: "issue", issue_id: issueId, thread_comment_id: entry.parent_id ?? entry.id }`，`editorRef` 用 `edit.editorRef`。
  - 建立任務：`{ kind: "none" }`，`editorRef` 用 `descEditorRef`，`onAdopted={(md) => setManual({ description: md })}`。
  - 快速建立：`{ kind: "none" }`，`onAdopted` 同時更新 `setAgent({ prompt: md })` 與 `hasContent`。

- [ ] 步驟 9.1：寫失敗測試：`edit comment shows the polish button`、`create-issue submits the adopted description`（採用後按建立，送出的 description 是優化後文字）、`quick-create keeps the adopted prompt`（採用後草稿的 prompt 是優化後文字、建立鈕可按）。
- [ ] 步驟 9.2：`pnpm --filter @multica/views exec vitest run issues/components/comment-card modals/create-issue modals/quick-create-issue`，確認失敗。
- [ ] 步驟 9.3：接上三個輸入框。
- [ ] 步驟 9.4：重跑步驟 9.2 全部通過。
- [ ] 步驟 9.5：commit `feat(E-50): polish button in edit, create and quick-create`。

## Task 10：「對話優化」開關、送出前攔截與固定用語（聊天、留言、回覆）

**Files:**
- Modify: `packages/core/issues/stores/comment-composer-store.ts`（與其測試）、`packages/views/settings/components/preferences-tab.tsx`（「評論與聊天」卡片）、六種語系 `settings.json`、`editor.json`
- Create: `packages/views/editor/polish/use-polish-gate.ts`、`use-polish-gate.test.tsx`、`packages/views/editor/quick-reply/quick-reply-menu.tsx`、`quick-reply-menu.test.tsx`
- Modify: `packages/views/chat/components/chat-input.tsx`、`packages/views/issues/components/comment-input.tsx`、`packages/views/issues/components/reply-input.tsx`

**Interfaces:**
- Consumes: Task 8 的 `PolishDialog`、`usePolishAvailable`。
- Produces：
  - `useCommentComposerStore` 新增 `polishOnSend: boolean`（預設 `false`，跟 `runningAgentReply` 一樣存在本機）與 `setPolishOnSend(value: boolean)`。
  - 偏好設定「評論與聊天」卡片新增一列 `PolishOnSendRow`（Switch），只有 `usePolishAvailable(wsId)` 為真時顯示。
  - `usePolishGate(opts: { wsId: string; context: PolishContext; editorRef: RefObject<ContentEditorRef | null>; submit: () => Promise<void>; onAdopted?: (markdown: string) => void }): { gatedSubmit: () => Promise<void>; dialog: ReactNode }`：
    - 開關關、不可用、或編輯器空白時，`gatedSubmit` 直接呼叫 `submit`。
    - 否則開 `mode="send"` 的 `PolishDialog`；「送出」時依序 `adoptContent(右欄)`、`onAdopted(右欄)`、`submit()`，再關閉。原本 `submit` 會帶的附件、收件代理的選擇（含「本次不會開始」）、插話／本輪結束後都照舊，因為走的是同一個 `submit`。
    - X 關閉時什麼都不送。
  - `QUICK_REPLIES = ["計畫已核准", "規格已定案", "有意見，討論中"] as const`：送出的文字固定是這三個中文字串，任何語系都不翻譯（門禁比對的是中文原文）；選單標籤也直接顯示這三個字串。
  - `QuickReplyMenu(props: { onPick: (text: string) => Promise<void>; disabled?: boolean })`：送出鍵旁的下拉選單（`Select`），預設空白、以淡色（muted 語意 token）顯示提示字「請決定」（`editor.json` 的 `quick_reply.placeholder`，各語系翻譯），選完送出後回到空白；aria-label 走 `quick_reply.label`。
- 接法：
  - 三個輸入框的送出鍵 `onClick` 與編輯器的送出快捷鍵（Enter 或 Ctrl+Enter）都改呼叫 `gatedSubmit`，並把 `dialog` 渲染在輸入框旁。
  - `QuickReplyMenu` 的 `onPick` 直接呼叫各輸入框原本傳給 `useComposerSubmit` 的 `onSubmit(text)`：不讀編輯器、不經 `usePolishGate`、不清空輸入框；收件代理的選擇照輸入框目前的設定。送出成功後用現有的 toast 顯示「已送出：<用語>」（`editor.json` 的 `quick_reply.sent`），附「查看」動作，捲到新留言（留言用 `comment-<id>` 錨點的既有捲動方式，聊天捲到訊息列表底部）。

- [ ] 步驟 10.1：寫失敗測試：`polishOnSend defaults to false and persists`（store）、`preferences shows the polish switch only when available`、`gate submits directly when off`、`gate opens the dialog instead of sending when on`、`enter key is gated too`、`send from the dialog submits the edited text with the recipient choices`（收件代理設成「本次不會開始」時，送出的請求仍帶 `suppress_agent_ids`）、`closing the dialog sends nothing`、`quick reply sends the exact text without opening the dialog`（開關打開時選「計畫已核准」，送出內容剛好是「計畫已核准」）、`quick reply keeps the draft`（輸入框原本的文字還在）、`quick reply shows the muted placeholder and resets after sending`、`quick reply toasts with a view action`。
- [ ] 步驟 10.2：`pnpm --filter @multica/core exec vitest run issues/stores` 與 `pnpm --filter @multica/views exec vitest run editor/polish editor/quick-reply settings/components/preferences-tab`，確認失敗。
- [ ] 步驟 10.3：實作 store 欄位、偏好設定列、`usePolishGate`、`QuickReplyMenu`、接到三個輸入框、六種語系 `settings.json` 與 `editor.json`。
- [ ] 步驟 10.4：重跑步驟 10.2 全部通過；`pnpm typecheck`、`pnpm lint`、`pnpm test`、`make test` 全綠。
- [ ] 步驟 10.5：依規格驗收 1–14 在本機實際操作並截圖放 PR 描述（用隔離的桌面版設定 `MULTICA_DESKTOP_CONFIG`，不用正式的 `~/.multica/desktop.json`）；commit `feat(E-50): polish before sending when the preference is on`。

## 完成檢查

- [ ] `make sqlc` 後 `git status` 沒有未提交的產生檔。
- [ ] `make test` 全綠；`go vet ./...` 無新警告。
- [ ] `grep -rn "openai-go" server --include=*.go` 只出現在 `server/pkg/llm/`。
- [ ] `pnpm typecheck`、`pnpm lint`、`pnpm test` 全綠。
- [ ] 規格驗收 1–14 都有截圖。
- [ ] 開 PR 進 `dev`（`gh pr create --repo TW199501/multica --base dev`），標題帶 `E-50`。
