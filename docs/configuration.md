# Configuration

AURA Gateway reads configuration from two places:

- **Environment variables**: connections, secrets and runtime switches.
- **`aura.config.yaml`**: behaviour: assistant persona, which entities are exposed, and household policy.

Both are validated at startup. If something is wrong, the Gateway refuses to start and tells you which key failed.

## Environment variables

| Variable                 | Default                     | Description                                                                                      |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `AURA_HOST`              | `0.0.0.0`                   | Bind address                                                                                     |
| `AURA_PORT`              | `8080`                      | HTTP port                                                                                        |
| `AURA_CONFIG_FILE`       | `aura.config.yaml`          | Path to the YAML config. If the file is missing, defaults apply.                                 |
| `AURA_API_KEYS`          | _(empty)_                   | Comma-separated API keys. **Empty means no authentication** (a warning is logged).               |
| `AURA_AUTH_EXEMPT_CIDRS` | _(empty)_                   | Comma-separated IPs/CIDRs that may call without a key, e.g. `192.168.1.10/32` for Home Assistant |
| `AURA_ENABLE_DOCS`       | `true`                      | Serve Swagger UI at `/docs` and the spec at `/docs-json`                                         |
| `AURA_OLLAMA_COMPAT`     | `true`                      | Expose the Ollama-compatible API under `/api`                                                    |
| `LLM_BASE_URL`           | `http://localhost:11434/v1` | OpenAI-compatible base URL (including `/v1`)                                                     |
| `LLM_API_KEY`            | _(empty)_                   | Bearer token for the LLM server, if it needs one                                                 |
| `LLM_MODEL`              | `qwen3:8b`                  | Model name as the server knows it                                                                |
| `LLM_TEMPERATURE`        | `0.3`                       | Sampling temperature                                                                             |
| `LLM_TIMEOUT_MS`         | `60000`                     | Timeout per LLM call                                                                             |
| `HA_URL`                 | _(empty)_                   | Home Assistant base URL. Leave it empty to run without smart-home tools.                         |
| `HA_TOKEN`               | _(empty)_                   | Long-lived access token (required when `HA_URL` is set)                                          |
| `HA_TIMEOUT_MS`          | `10000`                     | Timeout per Home Assistant call                                                                  |

Common `LLM_BASE_URL` values:

| Server                   | URL                         |
| ------------------------ | --------------------------- |
| Ollama                   | `http://localhost:11434/v1` |
| vLLM                     | `http://localhost:8000/v1`  |
| llama.cpp `llama-server` | `http://localhost:8080/v1`  |
| LM Studio                | `http://localhost:1234/v1`  |

## `aura.config.yaml`

Every key is optional. A complete, commented example is in [`examples/aura.config.yaml`](../examples/aura.config.yaml).

### `assistant`

| Key                 | Default          | Description                                                                         |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `name`              | `Aura`           | Name used in the prompt; it is also stripped from replies like "Aura, yes"          |
| `language`          | `en`             | Default language: used when an utterance gives no clear signal and detection is off |
| `detectLanguage`    | `true`           | Detect the language of each utterance and answer in it                              |
| `languages`         | `[en, de]`       | Languages considered by detection                                                   |
| `persona`           | `""`             | Extra instructions appended to the system prompt                                    |
| `timezone`          | system time zone | IANA time zone, used for the time in the prompt and `get_time`                      |
| `maxToolIterations` | `6`              | Upper bound on LLM ⇄ tool round trips per request                                   |

### `conversation`

| Key                      | Default | Description                                      |
| ------------------------ | ------- | ------------------------------------------------ |
| `ttlSeconds`             | `300`   | Forget a conversation after this much inactivity |
| `maxHistoryMessages`     | `12`    | User/assistant messages kept per conversation    |
| `confirmationTtlSeconds` | `60`    | How long a held action waits for "yes"           |

### Languages

AURA answers in the language you speak, per utterance. Say "Licht aus" and the answer is German; ask "What's the weather?" next and it switches to English. This is how the language for a turn is chosen:

1. `language` in the request (`POST /v1/conversation`), if set.
2. The language detected from the utterance, among `assistant.languages`.
3. The language of the previous turn in the same conversation, when the utterance gives no clear signal ("OK", "Netflix").
4. `assistant.language`.

Confirmations accept "yes"/"no" in every supported language, so answering an English question with "ja" works.

Built-in phrases (fast-path replies, confirmation questions) exist for English and German. For other languages the model still answers in the right language, but built-in phrases fall back to English. Contributions for more languages are welcome: add a phrase set in `src/conversation/phrases.ts` and markers in `src/conversation/language.ts`.

Speech-to-text and text-to-speech live in the voice pipeline, not in the Gateway. Use a multilingual STT model (e.g. Whisper without the `.en` suffix) and a TTS voice per language.

### `fastPath`

| Key       | Default                             | Description                                   |
| --------- | ----------------------------------- | --------------------------------------------- |
| `enabled` | `true`                              | Handle simple on/off commands without the LLM |
| `domains` | `light, switch, fan, input_boolean` | Domains the fast path may switch              |

The fast path recognises English ("turn off the kitchen light", "switch on the lights in the living room", "desk lamp on") and German ("Licht aus", "mach das Licht im Wohnzimmer an", "schalte die Stehlampe ein"). It acts only when the target is unambiguous and never for domains in `policy.confirmDomains`.

### `homeAssistant`

| Key                        | Default                                                                                                | Description                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `exposure.domains`         | `light, switch, cover, climate, fan, media_player, scene, script, sensor, binary_sensor, lock, vacuum` | Domains visible to the model                           |
| `exposure.includeEntities` | `[]`                                                                                                   | Extra entities outside those domains                   |
| `exposure.excludeEntities` | `[]`                                                                                                   | Entities never shown, even if their domain is exposed  |
| `injectEntities`           | `true`                                                                                                 | Put the visible entity list into the prompt            |
| `injectEntitiesLimit`      | `150`                                                                                                  | Only inject if the list has at most this many entities |
| `cacheSeconds`             | `10`                                                                                                   | Cache for `/api/states`                                |

### `policy`

See [Household policy](policy.md) for how these keys work together.

| Key              | Default                                        | Description                                     |
| ---------------- | ---------------------------------------------- | ----------------------------------------------- |
| `defaultProfile` | `guest`                                        | Profile used when nothing else matches          |
| `confirmDomains` | `[lock, alarm_control_panel]`                  | Domains whose actions need an explicit "yes"    |
| `profiles`       | `owner` (everything), `guest` (lights + media) | Named profiles (see below)                      |
| `speakers`       | `{}`                                           | Speaker id → profile                            |
| `rooms`          | `{}`                                           | Room/area → profile (for unidentified speakers) |
| `clients`        | `{}`                                           | API key fingerprint → profile                   |

A profile has these keys:

| Key            | Default   | Description                                                                        |
| -------------- | --------- | ---------------------------------------------------------------------------------- |
| `allowDomains` | `[]`      | Domains this profile may control. `*` allows all.                                  |
| `denyEntities` | `[]`      | Entities this profile can neither see nor control                                  |
| `areas`        | _(unset)_ | If set, control is limited to these areas. `$room` stands for the requesting room. |
| `readOnly`     | `false`   | The profile may read states but never call services                                |
| `description`  | —         | Free text                                                                          |

Note: once you define `profiles`, the built-in `owner`/`guest` profiles are replaced. Make sure `defaultProfile` names one of yours.
