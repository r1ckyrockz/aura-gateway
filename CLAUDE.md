# AURA Gateway: notes for AI coding agents

- Stack: NestJS 11, TypeScript (strict), zod 4 for all validation, Jest + supertest.
- Run `npm run check` before committing (format, lint, typecheck, unit, e2e).
- Every action on devices must go through `PolicyService`. Never rely on prompts for safety.
- Keep the LLM behind `LlmClient`. Tests use `src/testing/fake-llm.ts`; e2e uses fake HTTP upstreams in `test/`.
- Docs are in English. Update `docs/` and `CHANGELOG.md` with behaviour changes.
- Never commit real tokens, IPs or personal household data.
