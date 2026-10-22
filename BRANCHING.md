# 分支規範：本 repo 為【第 1 種：貢獻型 fork】

> 完整規範：[分支規範：三種 repo 類型](https://linear.app/elf-express/document/分支規範三種-repo-類型貢獻型-fork私有-fork自有專案-128bf6e5e1f9)（Linear）
> 本檔只記錄這個 repo 的設定。人與 AI 動手前請先讀完本檔。

## 本 repo 資訊

| 項目                        | 值                                                |
| --------------------------- | ------------------------------------------------- |
| 類型                        | 第 1 種：貢獻型 fork（fork 原作者，會送 PR 回饋） |
| 原作者 repo（`upstream`） | `multica-ai/multica`                            |
| 我們的 fork（`origin`）   | `TW199501/multica`                              |
| 下游私有 fork               | 無                                                |
| 上游貢獻規範                | https://github.com/multica-ai/multica/blob/main/CONTRIBUTING.md |

上游主線：`main`

> 上面這一行的格式固定（`上游主線：` 加反引號包住的分支名），git-guard 依它檢查 `main` 是否等於 `upstream/<上游主線>`。

行尾：LF，由 `.gitattributes` 規定（範本：elf-team-rule `assets/gitattributes`）

## 遠端設定

```
git remote add upstream https://github.com/multica-ai/multica.git
git remote -v
```

## 分支用途

| 分支                      | 用途                               | 可否提交                 | 從哪裡更新        |
| ------------------------- | ---------------------------------- | ------------------------ | ----------------- |
| `main`                  | 原作者 `main` 的鏡像，只用來同步 | **不提交，只快轉** | `upstream/main` |
| `dev`                   | 整合測試                           | 只能經由開發分支合併     | `main`          |
| `feat/`、`fix/`、`docs/`、`chore/`、`test/` | 開發                               | 可以                     | 從 `dev` 開出   |
| `pr/xxx`                | 送給原作者的 PR，一個分支一個主題  | 可以                     | 從 `main` 開出  |
| `release`               | 唯一的穩定版，給下游私有 fork 同步 | **不提交，只快轉** | 測過的 `dev`（緊急修正時 `hotfix/`） |
| `hotfix/`               | 緊急修正正式版                     | 可以                     | 從 `origin/release` 開出 |

開發分支命名 `<類型>/e-<編號>-<英文短名>`（類型：`feat`、`fix`、`docs`、`chore`、`test`、`hotfix`；有 Spec／Plan 用 Plan 編號，單一工作單用該單編號）。

## 本 repo 注意事項

* 上游的 `ci.yml`、`mobile-verify.yml` 只在 `main` 的 push 與 pull_request 觸發，fork 的 `dev`、`release`、`hotfix/**` 目前不會有 check run。快轉 `release` 前依 elf-team-rule 規則 28 處理；補上觸發方式要另開 `chore/` 分支（規則 29）。
* 上游的 `release.yml` 由 `v*.*.*` tag 觸發並發佈套件，fork 不推 tag。

## 常用指令

同步原作者：

```
git fetch upstream
git log --oneline origin/main..upstream/main   # 先列出會帶進來的提交
git switch main
git merge --ff-only upstream/main
git push origin main
```

更新 dev：

```
git switch dev
git merge main
git push origin dev
```

開發：

```
git fetch origin
git switch -c feat/e-<編號>-<短名> origin/dev
```

發佈給下游（`dev` 測試通過後）：

```
git fetch origin
git log --oneline origin/release..origin/dev   # 先列出會帶進去的提交，給使用者確認
git switch release
git merge --ff-only origin/release   # 先把本機 release 更新到最新
git merge --ff-only origin/dev
git push origin release
```

緊急修正（hotfix，`dev` 有未測完的內容時；完整步驟見 elf-team-rule `references/01-contribution-fork.md`）：

```
git fetch origin
git switch -c hotfix/e-<編號>-<短名> origin/release
# 修改、測試、提交後 git push -u origin hotfix/e-<編號>-<短名>
gh pr create --repo TW199501/multica --draft --base release --head hotfix/e-<編號>-<短名> --title "hotfix(E-<編號>): <說明>（僅觸發 CI，不要合併）" --body "E-<編號>"   # CI 沒有 hotfix/** 推送觸發時才需要；repo 沒有任何 workflow 時省略
git log --oneline origin/release..origin/hotfix/e-<編號>-<短名>   # 先列出會帶進去的提交，給使用者確認
gh api "repos/TW199501/multica/commits/$(git rev-parse origin/hotfix/e-<編號>-<短名>)/check-runs?filter=latest&per_page=100" --jq '.check_runs[]|"\(.status) \(.conclusion) \(.name)"'   # 全部通過才發佈（判斷方式見 elf-team-rule references/04 第 0 節）
git fetch origin && git switch release && git merge --ff-only origin/release && git merge --ff-only origin/hotfix/e-<編號>-<短名> && git push origin release   # 任何一步失敗 → 停下來回報
git fetch origin && git switch dev && git merge --ff-only origin/dev   # 立刻合回 dev；失敗 → 停下來回報
git log --oneline origin/dev..dev   # 必須是空的；有輸出 → 本機 dev 有沒推的提交，停下來回報
git merge --no-edit origin/release   # 有衝突 → git merge --abort，停下來回報
git push origin dev
```

發佈後提醒使用者：下游私有 fork 可以同步了。

送 PR 給原作者：

```
git switch -c pr/<短名> main
git cherry-pick -x <該主題的提交>       # 清單先給使用者確認；不 cherry-pick 合併提交
git push -u origin pr/<短名>
gh pr create --repo multica-ai/multica --base main --head TW199501:pr/<短名>   # 使用者明確同意後才執行
```

## 分支保護設定建議

建議在 GitHub 設定分支保護規則（Branch Protection Rules 或 Ruleset）：

* **`main` 與 `release`**：禁止 force push、禁止刪除、只允許維護者 push。**不要**設「必須經過 Pull Request」：這兩條分支是在本機 `merge --ff-only` 後直接 push 的，GitHub 的 PR 合併會產生新提交或新 SHA，無法快轉。
* **`dev`**：禁止 force push、禁止刪除；開發分支（`feat/*`、`fix/*`、`docs/*`、`chore/*`、`test/*`、`merge/*`）一律經 PR 合併，用 merge commit（elf-team-rule 規則 37），維護者保留直接 push 權限，給沒有衝突的 `main` → `dev` 同步合併與 hotfix 發佈後的 `release` → `dev` 合回使用；`dev` 設了 required status checks 時，維護者要列在 bypass 名單，否則本機做的合併提交推不上去（2026-10-13 實測，elf-team-rule 待確認 2）。

## 禁止事項

* 不在 `main`、`release` 上提交，也不 force push。緊急修正一律走 hotfix，不直接改 `release`／`main`。
* 不在 check runs 未全部通過、或沒有 CI 且使用者未明確同意例外時快轉 `release`。
* 不把 `main` 當穩定版或部署來源。
* 不直接在 `dev` 上開發。
* 不從 `dev` 或開發分支直接對原作者開 PR；一個 `pr/` 分支只放一個主題。
* 未經使用者明確同意，不對原作者的 repo 開 PR、留言或推送任何東西。
* `--ff-only` 失敗、合併或 cherry-pick 有衝突時，停下來回報，不要自行處理。
