# Contributing to AURA Gateway

Thanks for helping build a private, local-first home assistant!

## Ground rules

- **Local-first.** Features must work without any cloud service. Cloud integrations can be optional and must be off by default.
- **Policy in code.** Anything that acts on the physical world goes through `PolicyService`. Don't rely on prompts for safety.
- **Small and boring.** Prefer clear code and few dependencies over clever abstractions.

## Development setup

```bash
git clone https://github.com/r1ckyrockz/aura-gateway.git
cd aura-gateway
npm ci
cp .env.example .env
npm run start:dev
```

You don't need Home Assistant or a GPU to develop: the test suites use a scripted fake LLM and fake upstream servers.

## Before you open a pull request

```bash
npm run check   # format, lint, typecheck, unit + e2e tests
```

- Add or update tests for behaviour changes.
- Update the docs (`README.md`, `docs/`) and `CHANGELOG.md` under _Unreleased_.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat:`, `fix:`, `docs:` …).
- Keep pull requests focused. One topic per PR.

## Reporting bugs and proposing features

Use the issue templates. For bugs, include the Gateway version, LLM server and model, Home Assistant version, and the relevant log lines, **with tokens and personal data removed**.

For security issues, please do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
