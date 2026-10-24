# 用 Dockhand 部署（TW199501/multica 繁中版）

部署用的 compose 是 repo 根目錄的 [`docker-compose.dockhand.yml`](../../docker-compose.dockhand.yml)：服務同 `docker-compose.selfhost.yml`，但 backend 與 frontend 從原始碼建置，不使用上游的 GHCR 映像，所以部署出來的是這個 fork 的版本。

## Dockhand 設定（Deploy from Git）

| 欄位 | 值 |
| --- | --- |
| Repository URL | `https://github.com/TW199501/multica.git` |
| Branch | 正式環境用 `release`；測試環境可用 `dev` |
| Compose file path | `docker-compose.dockhand.yml` |
| Context directory | 留空（預設為 compose 檔所在的根目錄） |

Dockhand 會 clone 選定的分支並從它建置，所以選哪個分支就部署哪個分支。

環境變數照 [`.env.example`](.env.example) 填：`JWT_SECRET`（`openssl rand -hex 32`）與 `POSTGRES_PASSWORD` 必填，`FRONTEND_ORIGIN`、`MULTICA_PUBLIC_URL` 填對外網址，`MULTICA_BUILD_VERSION` 填版號（例如 `v0.7.0-tw.1` 或 `dev`）。

第一次部署會在主機上建置兩個映像，前端建置需要數分鐘，主機建議至少 4 GB 記憶體。amd64、arm64 主機都可以。

### 只貼 compose（沒有 repo）

把 `docker-compose.dockhand.yml` 的內容貼成一般 stack，另外設定
`MULTICA_BUILD_CONTEXT=https://github.com/TW199501/multica.git#release`（或 `#v0.7.0-tw.1` 等 tag），Docker 會自己拉原始碼建置。

## 對外連線

服務只綁在 `127.0.0.1`：前端 `FRONTEND_PORT`（預設 3000），API `PORT`（預設 8080）。用 Caddy、nginx 或 Cloudflare Tunnel 把網域轉到這兩個埠。不要把綁定改成 `0.0.0.0`。

## 確認部署成功

Dockhand 的 log 最後出現 `Successfully deployed multica`，並且在主機上：

```bash
curl http://127.0.0.1:8080/health     # {"status":"ok",...}
curl -I http://127.0.0.1:3000/         # 200
```

## 登入

設定 `RESEND_API_KEY` 或 `SMTP_*` 才會寄出驗證碼；都沒設時，驗證碼只會印在 backend 容器的 log。公開的機器不要設定 `MULTICA_DEV_VERIFICATION_CODE`。

## 為什麼不叫 compose.yaml

開發腳本（`scripts/ensure-postgres.sh` 等）執行 `docker compose` 時沒有指定 `-f`，Compose 會優先讀根目錄的 `compose.yaml`。部署檔若用這個名字，本機開發的資料庫就會被換掉。
