# Security Policy

AURA Gateway can unlock doors and disarm alarms if you let it, so we take security seriously.

## Reporting a vulnerability

Please **do not** open a public issue. Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/r1ckyrockz/aura-gateway/security/advisories/new). You'll get an acknowledgement within a few days. Please give us reasonable time to fix the issue before disclosing it.

## Supported versions

Only the latest minor release gets security fixes while the project is at 0.x.

## Threat model and hardening

AURA assumes a **trusted home network** and an **untrusted model**:

- The LLM can be confused by prompt injection, for example through entity names or state values. That's why every action is checked in code (exposure, profiles, areas, explicit `entity_id` targets) and sensitive domains need a confirmation the Gateway checks itself.
- `speaker` and `room` are asserted by the caller. Give API keys only to components that determine them honestly, and use one key per component.

Recommendations:

1. Always set `AURA_API_KEYS` (`openssl rand -hex 32`). Keep `AURA_AUTH_EXEMPT_CIDRS` as narrow as possible, ideally single `/32` addresses.
2. Never expose the Gateway directly to the internet. Use a VPN for remote access.
3. Create a dedicated Home Assistant user for AURA and expose only what you need.
4. Keep `lock`, `alarm_control_panel` and garage covers in `confirmDomains`, or don't expose them at all.
5. Set `AURA_ENABLE_DOCS=false` in production if you don't need the Swagger UI.
