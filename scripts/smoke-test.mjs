#!/usr/bin/env node
// AURA Gateway smoke test — sends a set of utterances to a running Gateway and reports
// route, latency, language and answer for each. Read-only cases run by default; cases that
// switch real devices (`action: true`) only run with --with-actions.
//
//   node scripts/smoke-test.mjs examples/smoke-test.en.yaml --url http://localhost:8080
//   AURA_API_KEY=… node scripts/smoke-test.mjs my-cases.yaml --with-actions --out results.json
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string', default: process.env.AURA_URL ?? 'http://localhost:8080' },
    key: { type: 'string', default: process.env.AURA_API_KEY ?? '' },
    'with-actions': { type: 'boolean', default: false },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || positionals.length !== 1) {
  console.log(
    'Usage: node scripts/smoke-test.mjs <cases.yaml> [--url URL] [--key KEY] [--with-actions] [--out FILE]',
  );
  process.exit(values.help ? 0 : 1);
}

const suite = parse(readFileSync(positionals[0], 'utf8'));
const defaults = suite.defaults ?? {};
const cases = suite.cases ?? [];
const base = values.url.replace(/\/+$/, '');
const headers = {
  'content-type': 'application/json',
  ...(values.key ? { authorization: `Bearer ${values.key}` } : {}),
};

async function say(body) {
  const started = performance.now();
  const response = await fetch(`${base}/v1/conversation`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - started);
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, ms, ...json };
}

function check(result, expect = {}) {
  const problems = [];
  if (!result.ok) problems.push(`HTTP ${result.status}: ${result.message ?? ''}`);
  for (const key of ['route', 'language']) {
    if (expect[key] && result[key] !== expect[key])
      problems.push(`${key}=${result[key]} (expected ${expect[key]})`);
  }
  if (
    expect.confirmation !== undefined &&
    Boolean(result.pendingConfirmation) !== expect.confirmation
  ) {
    problems.push(
      expect.confirmation ? 'expected a confirmation question' : 'unexpected confirmation',
    );
  }
  if (
    expect.textIncludes &&
    !String(result.text ?? '')
      .toLowerCase()
      .includes(expect.textIncludes.toLowerCase())
  ) {
    problems.push(`answer does not mention "${expect.textIncludes}"`);
  }
  if (expect.noErrors && (result.actions ?? []).some((a) => a.status === 'error'))
    problems.push('a tool call failed');
  return problems;
}

const health = await fetch(`${base}/health/ready`)
  .then((r) => r.json())
  .catch((e) => ({ status: `unreachable (${e.message})` }));
console.log(`AURA Gateway at ${base}: ${health.status}`);
if (health.checks)
  console.log(
    `  LLM: ${health.checks.llm?.status} · Home Assistant: ${health.checks.homeAssistant?.status}`,
  );
console.log(
  values['with-actions']
    ? '  Running ALL cases, including ones that switch devices.\n'
    : '  Read-only cases only (use --with-actions to include device actions).\n',
);

const results = [];
let index = 0;
for (const testCase of cases) {
  index++;
  if (testCase.action && !values['with-actions']) {
    results.push({ index, text: testCase.text, skipped: true });
    console.log(`#${String(index).padStart(2)} SKIP  ${testCase.text}`);
    continue;
  }
  const conversationId = `smoke-${Date.now()}-${index}`;
  const body = { ...defaults, ...testCase.request, text: testCase.text, conversationId };
  for (const field of ['room', 'speaker', 'language'])
    if (testCase[field] !== undefined) body[field] = testCase[field];

  const turns = [await say(body)];
  for (const followUp of testCase.followUps ?? [])
    turns.push(await say({ ...body, text: followUp }));

  const first = turns[0];
  const problems = check(first, testCase.expect);
  const pass = problems.length === 0;
  results.push({ index, text: testCase.text, pass, problems, turns });
  console.log(
    `#${String(index).padStart(2)} ${pass ? 'PASS' : 'FAIL'}  ${String(first.ms).padStart(5)} ms  ${(first.route ?? '-').padEnd(12)} ${(first.language ?? '-').padEnd(3)} ${testCase.text}`,
  );
  for (const turn of turns) console.log(`        → ${turn.text ?? JSON.stringify(turn)}`);
  for (const problem of problems) console.log(`        ! ${problem}`);
}

const ran = results.filter((r) => !r.skipped);
const percentile = (list, p) =>
  list.length
    ? list.sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(p * list.length))]
    : 0;
console.log(
  `\n${ran.filter((r) => r.pass).length}/${ran.length} passed, ${results.length - ran.length} skipped`,
);
for (const route of ['fast_path', 'llm', 'confirmation']) {
  const ms = ran.filter((r) => r.turns[0].route === route).map((r) => r.turns[0].ms);
  if (ms.length)
    console.log(
      `  ${route.padEnd(12)} n=${String(ms.length).padEnd(3)} p50=${percentile(ms, 0.5)} ms  p95=${percentile(ms, 0.95)} ms`,
    );
}
if (values.out) {
  writeFileSync(
    values.out,
    JSON.stringify({ url: base, at: new Date().toISOString(), health, results }, null, 2),
  );
  console.log(`\nDetails written to ${values.out}`);
}
process.exit(ran.every((r) => r.pass) ? 0 : 1);
