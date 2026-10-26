# Home Assistant integration

AURA uses Home Assistant in two directions:

- **AURA → Home Assistant:** reads states and areas and calls services over the REST API (the tools).
- **Home Assistant → AURA:** Home Assistant's Assist pipeline can use AURA as its _conversation agent_, so satellites that already work with Assist (Wyoming, ESPHome voice devices, the companion apps) talk to AURA.

## 1. Connect AURA to Home Assistant

1. In Home Assistant, open **your profile → Security → Long-lived access tokens** and create a token. Use a dedicated, **non-admin** `aura` user.
2. Set the token in `.env`:
   ```env
   HA_URL=http://homeassistant.local:8123
   HA_TOKEN=eyJhbGciOi...
   ```
3. Check: `curl http://localhost:8080/health/ready` should report `homeAssistant: up`.

**Areas** come from Home Assistant's area, device and entity registries over the WebSocket API (cached for 60 s). An entity inherits its device's area unless it has its own. This works for non-admin users; if the WebSocket is unavailable, AURA falls back to the template API, which needs an admin user. Assign your devices to areas. Room awareness and the `$room` policy depend on it.

**Exposure** is configured in AURA (`homeAssistant.exposure`), not through Home Assistant's "Expose to Assist" setting. That keeps AURA's view explicit and versionable. Start narrow and widen as needed.

## 2. Use AURA as the Assist conversation agent

### Option A: built-in Ollama integration (experimental, no custom component)

AURA offers an Ollama-compatible API (`/api/tags`, `/api/show`, `/api/chat`). Home Assistant's built-in **Ollama** integration can therefore point at AURA:

1. Home Assistant can't send an API key to Ollama servers, so allow its IP without one:
   ```env
   AURA_AUTH_EXEMPT_CIDRS=192.168.1.10/32   # your Home Assistant host
   ```
2. **Settings → Devices & services → Add integration → Ollama**. URL: `http://<aura-host>:8080`. Model: `aura:latest`.
3. In the integration's options, set **Control Home Assistant** to **No**. AURA brings its own tools and policy, and ignores tools sent by the client anyway.
4. **Settings → Voice assistants**: create or edit a pipeline and choose the new Ollama agent as **Conversation agent**.

Limitations: Home Assistant doesn't tell AURA which satellite or area a request came from, so requests through this path use `defaultProfile` (or the profile mapped to the client). Room-aware rights need Option B or C. The Ollama integration's internals can change between Home Assistant releases. Please open an issue if something breaks.

### Option B: OpenAI-compatible custom integrations

Community integrations that let you set a custom OpenAI base URL can use `http://<aura-host>:8080/v1` with model `aura` and an AURA API key. Some of them can also send extra headers; set `X-AURA-Room` / `X-AURA-Speaker` if they can.

### Option C: call AURA directly (recommended for AURA satellites)

A voice service that knows the satellite's area (and maybe the speaker) calls `POST /v1/conversation` with `room` and `speaker`. This is the path with full context and is what the AURA voice pipeline will use. A native Home Assistant custom integration that forwards `device_id` → area is on the [roadmap](../ROADMAP.md).

## 3. Tips

- Use a dedicated Home Assistant user for AURA. Non-admin is enough for state reads and service calls on exposed entities.
- Keep `confirmDomains` for anything that affects safety or security: locks, alarm panels, garage covers.
- Use `GET /v1/entities` to see exactly what AURA exposes.
