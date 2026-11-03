# Self-hosted llama.cpp for Multica AI settings

An optional, stand-alone package that runs a llama.cpp server exposing an
OpenAI-compatible API. It contains no Multica service; run it on any host the
Multica server can reach.

## Start

1. Download a GGUF model into `./models` and name it `model.gguf` (or edit the
   `-m` path in `docker-compose.yml`). For example, from Hugging Face:

   ```bash
   mkdir -p models
   curl -L -o models/model.gguf "https://huggingface.co/<org>/<repo>/resolve/main/<file>.gguf"
   ```

2. Start the server:

   ```bash
   docker compose up -d
   ```

   The API is then available at `http://<host>:8080/v1`.

## Connect Multica

1. In Multica, open **AI 代理 → AI 設定** (AI agents, AI settings) as a workspace admin.
2. Choose the self-hosted **llama.cpp** provider.
3. Enter `http://<host>:8080/v1` as the endpoint and leave the key empty.
4. For Qwen3-style models, tick **disable thinking** so replies are not delayed by a reasoning pass.
5. Run the connection test, then save.

Saving requires `MULTICA_AI_SECRET_KEY` to be set on the Multica server.

The image uses the floating `server` tag. Pin a `server-b<build>` tag from
<https://github.com/ggml-org/llama.cpp/pkgs/container/llama.cpp> if you need
reproducible deployments. The server has no authentication by default; do not
expose port 8080 to untrusted networks.
