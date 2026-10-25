# Roadmap

AURA Gateway is at **v0.2**: the core loop, policy, compatibility layers, fast path, event stream and metrics work and are tested. Next, roughly in order:

## v0.2: Voice-first

- [ ] Streaming answers (token streaming from the LLM → SSE/NDJSON) for faster time-to-first-word with TTS
- [x] Fast path for simple commands ("light on in the kitchen") without an LLM round-trip
- [x] SSE event stream for satellites and displays (thinking, answering, pending confirmation)
- [x] Per-request latency metrics (Prometheus `/metrics`)

## v0.3: Home Assistant native

- [ ] Home Assistant custom integration `aura` (conversation agent) that forwards `device_id` → area and satellite identity
- [ ] Use Home Assistant's WebSocket API for live state instead of polling
- [ ] Timers, reminders and shopping/to-do lists as tools

## v0.4: Memory & personalisation (opt-in)

- [ ] Durable, inspectable memory per household member (preferences, routines), stored locally and deletable
- [ ] Proactive suggestions ("You usually dim the lights at 9 pm. Should I automate that?")
- [ ] "What can you do?": self-describing capabilities per profile

## Later

- [ ] Multiple LLMs with routing (small/fast for commands, large for questions)
- [ ] Vision tools (camera snapshots described by a local VLM)
- [ ] Optional, explicitly enabled cloud fallback, off by default
- [ ] Evaluation harness: a regression set of household utterances per language and model

Ideas and feedback are welcome in [GitHub Discussions/Issues](https://github.com/r1ckyrockz/aura-gateway/issues).
