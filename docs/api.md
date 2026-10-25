# API

Interactive reference: **`/docs`** (Swagger UI), with the spec at `/docs-json`.

Authentication: `Authorization: Bearer <key>` or `x-api-key: <key>` on every endpoint except `/health*`. This only applies when `AURA_API_KEYS` is set.

## Native API

### `POST /v1/conversation`

Send an utterance and get back a speakable answer.

```json
{
  "text": "Is the front door locked?",
  "conversationId": "kitchen-satellite-1",
  "speaker": "parent_1",
  "room": "Kitchen",
  "language": "en"
}
```

| Field            | Required | Description                                                                                         |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `text`           | ✓        | What the user said (1–4000 characters)                                                              |
| `conversationId` |          | Reuse it to continue a conversation; needed for follow-ups and confirmations. Generated if missing. |
| `speaker`        |          | Identified speaker id → `policy.speakers`                                                           |
| `room`           |          | Area the request comes from → room awareness and `policy.rooms`                                     |
| `language`       |          | Overrides `assistant.language` for this request                                                     |

Response:

```json
{
  "conversationId": "kitchen-satellite-1",
  "text": "Yes, the front door is locked.",
  "principal": {
    "profile": "adult",
    "resolvedBy": "speaker",
    "speaker": "parent_1",
    "room": "Kitchen"
  },
  "actions": [
    {
      "tool": "ha_get_state",
      "arguments": { "entity_id": "lock.front_door" },
      "status": "ok",
      "result": { "state": "locked" }
    }
  ],
  "pendingConfirmation": null,
  "route": "llm",
  "usage": { "promptTokens": 790, "completionTokens": 22, "llmCalls": 2 }
}
```

`route` says how the answer was produced: `fast_path` (simple command, no LLM), `llm` or `confirmation` (a reply to a held action).

`actions[].status` is `ok`, `error` (including `not_permitted`) or `pending_confirmation`.

When an action needs confirmation, `pendingConfirmation` is set:

```json
{ "id": "6a1c…", "summary": "lock.unlock → Front Door", "expiresAt": "2026-10-25T21:04:12.000Z" }
```

### `POST /v1/conversation/{conversationId}/confirmation`

Approve or reject a held action without going through speech (an app button, a satellite touch display).

```json
{ "approve": true }
```

### `GET /v1/tools`

The tools currently offered to the model, with their JSON schemas.

### `GET /v1/entities?speaker=&room=`

Entities visible to that principal, each with `controllable` and `requiresConfirmation`. Useful for checking your policy.

### `GET /v1/events?room=&conversationId=&types=`

A Server-Sent Events stream of conversation lifecycle events, for satellites, displays and dashboards. Browsers' `EventSource` can't send headers, so this endpoint also accepts `?access_token=<key>`.

| Event                    | `data`                                         |
| ------------------------ | ---------------------------------------------- |
| `conversation.started`   | `{ profile }`                                  |
| `tool.executed`          | `{ tool, status }`                             |
| `confirmation.requested` | `{ id, summary, expiresAt }`                   |
| `confirmation.resolved`  | `{ outcome: approved \| rejected \| dropped }` |
| `conversation.answered`  | `{ text, route, durationMs }`                  |
| `ping`                   | heartbeat every 25 s                           |

Every event carries `type`, `conversationId`, `room`, `speaker` and `at`.

```js
const events = new EventSource(`/v1/events?room=Kitchen&access_token=${key}`);
events.addEventListener('conversation.started', () => ring.pulse());
events.addEventListener('conversation.answered', (e) => display.show(JSON.parse(e.data).data.text));
```

### `GET /metrics`

Prometheus metrics. Requires an API key when keys are configured; use `authorization` in your scrape config.

| Metric                               | Labels             |
| ------------------------------------ | ------------------ |
| `aura_conversations_total`           | `route`, `profile` |
| `aura_conversation_duration_seconds` | `route`            |
| `aura_llm_request_duration_seconds`  | `outcome`          |
| `aura_llm_tokens_total`              | `kind`             |
| `aura_tool_calls_total`              | `tool`, `status`   |

It also exports the default Node.js process metrics (prefixed `aura_`).

## OpenAI-compatible API

- `GET /v1/models` lists the single model `aura`.
- `POST /v1/chat/completions` takes the standard request; `stream: true` returns SSE.

AURA uses the last user message as the utterance and earlier user/assistant messages as history. Client `system` messages and `tools` are **ignored**, because AURA uses its own prompt, tools and policy. The response carries an extra `aura` object with `conversation_id`, `actions` and `pending_confirmation`.

Optional headers: `X-AURA-Conversation-Id`, `X-AURA-Speaker`, `X-AURA-Room`. Without a conversation id (header or the `user` field), AURA derives one from the client IP plus the first user message.

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $AURA_API_KEY" -H "Content-Type: application/json" \
  -H "X-AURA-Room: Living Room" \
  -d '{"model":"aura","messages":[{"role":"user","content":"Dim the lights to 30 percent"}]}'
```

## Ollama-compatible API (experimental)

Enabled with `AURA_OLLAMA_COMPAT=true` (the default).

- `GET /api/version`, `GET /api/tags` (model `aura:latest`), `POST /api/show`
- `POST /api/chat` streams NDJSON by default; send `"stream": false` for a single JSON object.

Same message handling and headers as the OpenAI facade.

## Health

- `GET /health` is the liveness probe and always returns `200` while the process runs.
- `GET /health/ready` returns `200` when the LLM server is reachable and Home Assistant is up (or not configured), and `503` otherwise.

## Errors

| Status | Meaning                                            |
| ------ | -------------------------------------------------- |
| `400`  | Validation failed (`issues` lists the fields)      |
| `401`  | Missing or invalid API key                         |
| `502`  | The LLM server or Home Assistant returned an error |
| `504`  | The LLM server or Home Assistant timed out         |
