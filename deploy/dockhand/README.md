# 用 Dockhand 部署（TW199501/multica 繁中版）

這個目錄是 fork 專用的部署設定，從 `release` 分支的原始碼建置 backend 與 frontend，不使用上游的 GHCR 映像。

## Dockhand 設定

1. 新增 Git stack：
   - Repository：`https://github.com/TW199501/multica`
   - Branch：`release`
   - Compose file：`deploy/dockhand/compose.yaml`
2. 環境變數照 [`.env.example`](.env.example) 填，`JWT_SECRET`（`openssl rand -hex 32`）與 `POSTGRES_PASSWORD` 必填。
3. 部署。第一次會在主機上建置兩個映像，前端建置需要數分鐘，主機建議至少 4 GB 記憶體。

## 對外連線

服務只綁在 `127.0.0.1`：前端 `FRONTEND_PORT`（預設 3000），API `PORT`（預設 8080）。用 Caddy、nginx 或 Cloudflare Tunnel 把網域轉到這兩個埠，並讓 `FRONTEND_ORIGIN`、`MULTICA_PUBLIC_URL` 與對外網址一致。不要把綁定改成 `0.0.0.0`。

## 更新

`release` 快轉後，在 Dockhand 重新部署（會重新拉取並建置），並把 `MULTICA_BUILD_VERSION` 改成新的 tag。

## 登入

設定 `RESEND_API_KEY` 或 `SMTP_*` 才會寄出驗證碼；都沒設時，驗證碼只會印在 backend 容器的 log。公開的機器不要設定 `MULTICA_DEV_VERIFICATION_CODE`。
