# Deployment: step by step

This guide sets up AURA Gateway for a first real test:

- **Gateway**: a small Linux container next to Home Assistant (example: Proxmox LXC with Docker)
- **LLM**: [LM Studio](https://lmstudio.ai) on a Mac in the same network. Ollama, vLLM or llama.cpp work the same way.
- **Home Assistant**: uses AURA as the conversation agent for Assist

Allow about an hour. Each step ends with a check, so you know it worked before you move on.

```
 Mac (LM Studio :1234) ◄──── AURA Gateway (:8080) ────► Home Assistant (:8123)
                                   ▲                         │
                                   └──── Assist pipeline ◄───┘
```

## 0. Before you start

- Home Assistant 2025.x or later, with your devices assigned to **areas**. Room awareness depends on them.
- A Mac with Apple Silicon and 16 GB RAM or more (or any machine that can run a small LLM)
- A host for the container: Proxmox, a NAS with Docker, or a Raspberry Pi 5. About 1 vCPU and 1 GB RAM is enough.
- Fixed IP addresses (DHCP reservations) for the Mac and the Gateway host

Write down three addresses; you'll need them throughout:

|                                 | Example                    |
| ------------------------------- | -------------------------- |
| `HA` Home Assistant             | `http://192.168.1.10:8123` |
| `GW` Gateway host               | `192.168.1.20`             |
| `MAC` the Mac running LM Studio | `192.168.30.15`            |

## 1. Run the LLM on the Mac (LM Studio)

1. Install LM Studio and open it.
2. **Download a model.** Pick a small **instruct** model with **tool use** support (LM Studio shows a tool/hammer badge). Good choices for voice:
   - `Qwen3-4B-Instruct-2507`: fast, solid tool calling
   - `Qwen3-8B`: smarter, a bit slower. It is a reasoning model: add `/no_think` to `assistant.persona` (step 4) to skip the thinking phase.

   Avoid large or "thinking" models for voice. Every second counts.

3. **Developer** tab → load the model → **Settings**:
   - Context length: 8192 is plenty
   - Server port: `1234`
   - **Serve on Local Network**: on (otherwise only the Mac itself can connect)
   - Optional: **Just-in-time model loading** off and "keep model loaded" on, so the first request after a pause isn't slow
4. Start the server (status: _Running_).
5. macOS: allow incoming connections for LM Studio if the firewall asks. Set **System Settings → Energy → Prevent automatic sleeping when the display is off** for the test session.

✅ **Check from another machine**, e.g. the Gateway host:

```bash
curl http://MAC:1234/v1/models
```

You should see your model's id, e.g. `qwen3-4b-instruct-2507`. Note it for `LLM_MODEL`.

If the Mac and the Gateway host are in **different VLANs**, allow TCP `1234` from the Gateway host to the Mac in your firewall.

## 2. Create a Home Assistant user and token for AURA

1. **Settings → People → Users → Add user**: name `AURA`, username `aura`. **Administrator: off.** AURA doesn't need admin rights.
2. Log in as `aura` (private browser window) → click the user name (bottom left) → **Security** → **Long-lived access tokens** → _Create token_. Copy it; you won't see it again.

✅ **Check:**

```bash
curl -H "Authorization: Bearer TOKEN" HA/api/
# {"message":"API running."}
```

## 3. Prepare the Gateway host (Proxmox LXC example)

1. In Proxmox: **Create CT** → Debian 12 template, unprivileged, 1 core, 1024 MB RAM, 8 GB disk, static IP `GW/24` in the same network as Home Assistant.
2. **Options → Features**: enable `nesting` and `keyctl` (needed for Docker in LXC).
3. Start the container and open its console:

   ```bash
   apt update && apt install -y curl git
   curl -fsSL https://get.docker.com | sh
   ```

✅ **Check:** `docker run --rm hello-world` prints "Hello from Docker!".

Without Docker: install Node.js 24, clone the repo, then run `npm ci && npm run build && node dist/main.js` (for example as a systemd service).

## 4. Configure and start the Gateway

```bash
git clone https://github.com/r1ckyrockz/aura-gateway.git /opt/aura-gateway
cd /opt/aura-gateway
cp .env.example .env
cp examples/aura.config.yaml aura.config.yaml
openssl rand -hex 32        # → your API key
```

Edit `.env`:

```env
AURA_API_KEYS=<the key you just generated>
AURA_AUTH_EXEMPT_CIDRS=<HA IP>/32     # lets Home Assistant's Ollama integration in without a key
LLM_BASE_URL=http://MAC:1234/v1
LLM_MODEL=qwen3-4b-instruct-2507      # id from step 1
HA_URL=HA
HA_TOKEN=<token from step 2>
```

Edit `aura.config.yaml`. At minimum:

- `assistant.language`: your default language, e.g. `de`
- `homeAssistant.exposure`: **review this carefully.** Expose what AURA should see. Exclude anything dangerous or confusing: door openers modelled as switches, inverter or battery modes, appliance power switches, heating relays that a thermostat controls. Patterns help, e.g. `switch.*_relay` or `name:*Deckenheizung`.
- `policy.confirmEntities`: anything that opens, unlocks or could cause damage, e.g. `name:*Door*relay`
- `policy.speakers` / `policy.rooms`: who may do what (see [policy](policy.md))

Start it:

```bash
docker compose up -d --build
docker compose logs -f aura-gateway
```

✅ **Check:**

```bash
curl http://GW:8080/health/ready
# {"status":"ok", ... "llm":{"status":"up"}, "homeAssistant":{"status":"up"}}

curl -H "Authorization: Bearer KEY" "http://GW:8080/v1/entities?speaker=parent_1" | head -c 600
```

The entity list is the moment of truth: only what AURA should see, each with the right `area`. If `area` is `null` everywhere, check the logs for "Area registry" warnings.

## 5. Talk to it (before involving Home Assistant)

```bash
curl -s http://GW:8080/v1/conversation \
  -H "Authorization: Bearer KEY" -H "Content-Type: application/json" \
  -d '{"text":"Wie warm ist es im Wohnzimmer?","speaker":"parent_1","room":"Wohnzimmer"}'
```

Then run the smoke test. Copy `examples/smoke-test.en.yaml`, adapt it to your rooms and devices, and run it from any machine with Node.js 22+:

```bash
AURA_API_KEY=KEY node scripts/smoke-test.mjs my-cases.yaml --url http://GW:8080            # read-only
AURA_API_KEY=KEY node scripts/smoke-test.mjs my-cases.yaml --url http://GW:8080 --with-actions --out results.json
```

✅ **What good looks like:** `fast_path` answers in well under 500 ms, `llm` answers in 1–3 s with a small model, no failed tool calls, and confirmations for everything sensitive.

## 6. Use AURA as the Assist conversation agent

1. **Settings → Devices & services → Add integration → Ollama**
   - URL: `http://GW:8080`
   - Model: `aura:latest`
2. Open the new conversation agent's options:
   - **Control Home Assistant / LLM API: none.** AURA brings its own tools and policy.
   - Leave the instructions empty (AURA ignores them).
3. **Settings → Voice assistants → Add assistant**: name `AURA`, language German (or yours), **Conversation agent: the Ollama/AURA agent**.
   - **Prefer handling commands locally: off.** Otherwise Home Assistant answers simple commands itself and AURA never sees them.
   - Speech-to-text / text-to-speech: whatever you use (e.g. Whisper and Piper). This doesn't matter for the text test.

✅ **Check:** open **Assist** (top right in the dashboard), select the `AURA` assistant and type _"Wie warm ist es im Wohnzimmer?"_. You should see AURA's answer, and `docker compose logs` should show the request.

Requests through Home Assistant don't carry the room or speaker yet, so they use `policy.defaultProfile`. Choose a sensible default for the test, and see [Home Assistant](home-assistant.md) for the limitations.

## Troubleshooting

| Symptom                                                        | Likely cause                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/health/ready` → `llm: down`                                  | LM Studio server stopped, "Serve on Local Network" off, Mac asleep, or the firewall/VLAN blocks port 1234           |
| `homeAssistant: down`, 401                                     | Wrong token, or `HA_URL` includes `/api` (it must not)                                                              |
| Areas are `null`                                               | Devices not assigned to areas in Home Assistant, or the WebSocket connection is blocked by a proxy. Check the logs. |
| Answers are slow (> 5 s)                                       | Model too big, or a reasoning model thinking. Use a smaller instruct model or `/no_think`.                          |
| "Turn off the light" is answered by the LLM, not the fast path | The room is unknown (no `room` sent) or there are no light-like devices in that area                                |
| HA's Ollama integration can't connect                          | `AURA_AUTH_EXEMPT_CIDRS` doesn't include HA's IP, or `AURA_OLLAMA_COMPAT=false`                                     |
| The model claims to have done something it didn't              | Look at `actions` in the response: AURA reports the real tool results. Try a model with better tool calling.        |
