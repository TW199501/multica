# Self-hosted llama.cpp for Multica AI settings

An optional, stand-alone package that runs a llama.cpp server exposing an
OpenAI-compatible API. It contains no Multica service; run it on any host the
Multica server can reach.

You choose the model and where it lives. Nothing is downloaded for you, and
no model path is fixed.

## Start

1. Copy `.env.example` to `.env` and set:
   - `LLAMA_MODELS_DIR`: the folder on this host that already holds your GGUF
     files. Reuse the folder another tool already uses, so the same model is
     not stored twice.
   - `LLAMA_MODEL`: the GGUF file name inside that folder.
   - `LLAMA_PORT` (optional): the host port, `8080` by default.

2. Start the server:

   ```bash
   docker compose up -d
   ```

   The API is then available at `http://<host>:<LLAMA_PORT>/v1`.

## Already running a model server?

You do not need this package if you already run llama.cpp, Ollama, LM Studio
or another server with an OpenAI-compatible API. Point Multica at it instead:

- llama.cpp `llama-server`: `http://<host>:<port>/v1`
- Ollama: `http://<host>:11434/v1`, with the model name as Ollama lists it
- LM Studio: `http://<host>:1234/v1`

Choose **Self-hosted (llama.cpp)** for a keyless server, or **Custom** for one
that needs a key.

## Connect Multica

1. In Multica, open **Agents → AI settings** as a workspace admin.
2. Choose the **Self-hosted (llama.cpp)** provider.
3. Enter the endpoint above and leave the key empty.
4. For Qwen3-style models, turn on **Disable thinking** so replies are not delayed by a reasoning pass.
5. Run the connection test, then save.

Saving requires `MULTICA_AI_SECRET_KEY` to be set on the Multica server.

The Multica server refuses AI endpoints on localhost and private addresses. List
this server's address in `MULTICA_AI_ALLOW_CIDRS` on the Multica server, for
example `192.168.25.14/32`. Every workspace owner can then reach that range, so
keep it narrow.

The image uses the floating `server` tag. Pin a `server-b<build>` tag from
<https://github.com/ggml-org/llama.cpp/pkgs/container/llama.cpp> if you need
reproducible deployments. The server has no authentication by default; do not
expose its port to untrusted networks.
