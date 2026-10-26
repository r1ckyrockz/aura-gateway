import type { INestApplication } from '@nestjs/common';
import { get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createApp } from '../src/bootstrap';
import { parseAuraConfig, parseEnv } from '../src/config/load-config';
import { FakeServer, type Recorded } from './fake-upstreams';

const KEY = 'test-key';

/** Scripted LLM: turns on the kitchen light when asked, otherwise chats. */
function llmHandler(req: Recorded) {
  if (req.url === '/v1/models') return { data: [{ id: 'fake' }] };
  if (req.url !== '/v1/chat/completions') return undefined;
  const body = req.body as { messages: { role: string; content: string | null }[] };
  const last = body.messages.at(-1)!;
  if (last.role === 'tool') {
    return {
      choices: [
        { message: { role: 'assistant', content: 'Kitchen light is on.' }, finish_reason: 'stop' },
      ],
    };
  }
  if (last.content?.includes('light')) {
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'ha_call_service',
                  arguments: JSON.stringify({
                    domain: 'light',
                    service: 'turn_on',
                    entity_id: 'light.kitchen',
                  }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    };
  }
  return {
    choices: [
      { message: { role: 'assistant', content: 'Hello from Aura.' }, finish_reason: 'stop' },
    ],
  };
}

function haHandler(req: Recorded) {
  if (req.auth !== 'Bearer ha-token') return undefined;
  if (req.url === '/api/') return { message: 'API running.' };
  if (req.url === '/api/states') {
    return [
      { entity_id: 'light.kitchen', state: 'off', attributes: { friendly_name: 'Kitchen Light' } },
    ];
  }
  if (req.url === '/api/template') return JSON.stringify([{ e: 'light.kitchen', a: 'Kitchen' }]);
  if (req.url?.startsWith('/api/services/light/')) return [];
  return undefined;
}

describe('AURA Gateway (e2e)', () => {
  const llm = new FakeServer(llmHandler);
  const ha = new FakeServer(haHandler);
  let app: INestApplication<App>;

  beforeAll(async () => {
    const [llmUrl, haUrl] = await Promise.all([llm.start(), ha.start()]);
    app = (await createApp({
      env: parseEnv({
        LLM_BASE_URL: `${llmUrl}/v1`,
        HA_URL: haUrl,
        HA_TOKEN: 'ha-token',
        AURA_API_KEYS: KEY,
      }),
      aura: parseAuraConfig({ policy: { defaultProfile: 'owner' } }),
      source: null,
    })) as INestApplication<App>;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([llm.stop(), ha.stop()]);
  });

  const auth = { authorization: `Bearer ${KEY}` };

  it('GET /health is public', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ok'));
  });

  it('GET /health/ready checks upstreams', async () => {
    const { body } = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(body.checks.llm.status).toBe('up');
    expect(body.checks.homeAssistant.status).toBe('up');
  });

  it('rejects requests without an API key', async () => {
    await request(app.getHttpServer()).post('/v1/conversation').send({ text: 'hi' }).expect(401);
  });

  it('validates the body', async () => {
    await request(app.getHttpServer())
      .post('/v1/conversation')
      .set(auth)
      .send({ text: '' })
      .expect(400);
  });

  it('POST /v1/conversation controls Home Assistant through tools', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/v1/conversation')
      .set(auth)
      .send({ text: 'Make the kitchen light brighter', room: 'Kitchen' })
      .expect(200);
    expect(body.text).toBe('Kitchen light is on.');
    expect(body.actions[0]).toMatchObject({ tool: 'ha_call_service', status: 'ok' });
    expect(ha.requests.find((r) => r.url === '/api/services/light/turn_on')?.body).toEqual({
      entity_id: ['light.kitchen'],
    });
  });

  it('POST /v1/chat/completions speaks OpenAI', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set(auth)
      .send({ model: 'aura', messages: [{ role: 'user', content: 'Hi' }] })
      .expect(200);
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('Hello from Aura.');
  });

  it('streams OpenAI SSE', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set(auth)
      .send({ stream: true, messages: [{ role: 'user', content: 'Hi' }] })
      .expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('Hello from Aura.');
    expect(res.text.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('POST /api/chat speaks Ollama (NDJSON stream by default)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/chat')
      .set(auth)
      .send({ model: 'aura:latest', messages: [{ role: 'user', content: 'Hi' }] })
      .expect(200);
    const lines = res.text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0].message.content).toBe('Hello from Aura.');
    expect(lines.at(-1).done).toBe(true);
  });

  it('GET /api/tags lists the aura model', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/tags').set(auth).expect(200);
    expect(body.models[0].name).toBe('aura:latest');
  });

  it('GET /v1/entities shows what a principal may do', async () => {
    const { body } = await request(app.getHttpServer()).get('/v1/entities').set(auth).expect(200);
    expect(body.entities).toEqual([
      expect.objectContaining({ entity_id: 'light.kitchen', area: 'Kitchen', controllable: true }),
    ]);
  });

  it('handles simple commands on the fast path (no LLM call)', async () => {
    const before = llm.requests.length;
    const { body } = await request(app.getHttpServer())
      .post('/v1/conversation')
      .set(auth)
      .send({ text: 'Turn off the kitchen light' })
      .expect(200);
    expect(body.route).toBe('fast_path');
    expect(body.text).toBe('Kitchen Light is now off.');
    expect(llm.requests.length).toBe(before);
  });

  it('answers in the language of the utterance', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/v1/conversation')
      .set(auth)
      .send({ text: 'Schalte bitte das Kitchen Light ein' })
      .expect(200);
    expect(body).toMatchObject({
      route: 'fast_path',
      language: 'de',
      text: 'Kitchen Light ist jetzt an.',
    });
  });

  it('GET /metrics exposes Prometheus metrics behind auth', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(401);
    const res = await request(app.getHttpServer()).get('/metrics').set(auth).expect(200);
    expect(res.text).toContain('aura_conversations_total');
    expect(res.text).toContain('aura_llm_request_duration_seconds');
  });

  it('GET /v1/events streams lifecycle events (query token, room filter)', async () => {
    const server = app.getHttpServer() as unknown as Server;
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const received = new Promise<string>((resolve, reject) => {
      const req = get(
        `http://127.0.0.1:${port}/v1/events?room=kitchen&access_token=${KEY}`,
        (res) => {
          expect(res.statusCode).toBe(200);
          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            if (buffer.includes('event: conversation.answered')) {
              req.destroy();
              resolve(buffer);
            }
          });
        },
      );
      req.on('error', (error) =>
        error.message.includes('socket hang up') ? undefined : reject(error),
      );
    });
    await new Promise((r) => setTimeout(r, 100));
    await request(server)
      .post('/v1/conversation')
      .set(auth)
      .send({ text: 'Hi', room: 'Living Room' })
      .expect(200);
    await request(server)
      .post('/v1/conversation')
      .set(auth)
      .send({ text: 'Hi', room: 'Kitchen' })
      .expect(200);
    const stream = await received;
    expect(stream).toContain('event: conversation.started');
    expect(stream).toContain('"room":"Kitchen"');
    expect(stream).not.toContain('Living Room');
  });

  it('rejects query tokens outside the event stream', async () => {
    await request(app.getHttpServer()).get(`/v1/tools?access_token=${KEY}`).expect(401);
  });

  it('serves OpenAPI docs', async () => {
    await request(app.getHttpServer()).get('/docs-json').expect(200);
  });

  it('maps upstream failures to 502', async () => {
    await llm.stop();
    await request(app.getHttpServer())
      .post('/v1/conversation')
      .set(auth)
      .send({ text: 'Hi' })
      .expect(502);
  });
});
