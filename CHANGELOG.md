# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Upgraded to NestJS 12 (Nest packages are ESM; the Gateway stays CommonJS and loads them via `require(esm)`, so Node.js ≥ 22.12 is required)
- Test runner switched from Jest to Vitest + SWC
- Docker image now uses Node.js 24 LTS; CI tests Node 22 and 24
- ESLint 10, TypeScript 5.9; removed unused `@nestjs/config`

## [0.1.0] - 2026-10-25

### Added

- Conversation API `POST /v1/conversation` with LLM ⇄ tool loop and short-term memory
- Built-in tools: `get_time`, `ha_list_entities`, `ha_get_state`, `ha_call_service`
- Household policy: profiles per speaker / API client / room, `allowDomains`, `denyEntities`, `areas` with `$room`, read-only profiles
- Deterministic confirmations for sensitive domains, plus `POST /v1/conversation/{id}/confirmation`
- OpenAI-compatible `/v1/models` and `/v1/chat/completions` (incl. SSE streaming)
- Experimental Ollama-compatible `/api/tags`, `/api/show`, `/api/chat` for Home Assistant's Ollama integration
- API-key authentication with CIDR exemptions
- Health and readiness probes, Swagger UI, Docker image, CI
