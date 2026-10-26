import type { Mock } from 'vitest';
import type { AuraConfig } from '../config/aura-config.schema';
import { EntityDirectory } from '../home-assistant/entity-directory.service';
import type { HomeAssistantClient } from '../home-assistant/ha.client';
import type { HaState } from '../home-assistant/ha.types';
import { PolicyService } from '../policy/policy.service';
import { FakeLlm } from '../testing/fake-llm';
import { testConfig } from '../testing/fixtures';
import { GetTimeTool } from '../tools/builtin/get-time.tool';
import { HaCallServiceTool } from '../tools/builtin/ha-call-service.tool';
import { HaGetStateTool } from '../tools/builtin/ha-get-state.tool';
import { HaListEntitiesTool } from '../tools/builtin/ha-list-entities.tool';
import { ToolRegistry } from '../tools/tool-registry.service';
import { ConversationService, stripThinking } from './conversation.service';
import { ConversationStore } from './conversation.store';
import { FastPathService } from './fast-path.service';
import { EventBus, type AuraEvent } from '../events/event-bus.service';
import { MetricsService } from '../metrics/metrics.service';

const states: HaState[] = [
  { entity_id: 'light.kitchen', state: 'off', attributes: { friendly_name: 'Kitchen Light' } },
  { entity_id: 'light.kids', state: 'off', attributes: { friendly_name: 'Kids Light' } },
  { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Front Door' } },
  { entity_id: 'automation.secret', state: 'on', attributes: { friendly_name: 'Not exposed' } },
];
const areas = new Map([
  ['light.kitchen', 'Kitchen'],
  ['light.kids', 'Kids Room'],
  ['lock.front_door', 'Hallway'],
]);

function setup(steps: ConstructorParameters<typeof FakeLlm>[0], config: AuraConfig = testConfig()) {
  const ha = {
    enabled: true,
    getStates: vi.fn(async () => states),
    getAreas: vi.fn(async () => areas),
    callService: vi.fn(async () => []),
  } as unknown as HomeAssistantClient & { callService: Mock };
  const directory = new EntityDirectory(ha, config);
  const policy = new PolicyService(config);
  const registry = new ToolRegistry([
    new GetTimeTool(),
    new HaListEntitiesTool(ha, directory, policy),
    new HaGetStateTool(ha, directory, policy),
    new HaCallServiceTool(ha, directory, policy),
  ]);
  const llm = new FakeLlm(steps);
  const events = new EventBus();
  const emitted: AuraEvent[] = [];
  events.stream().subscribe((e) => emitted.push(e));
  const metrics = new MetricsService();
  const service = new ConversationService(
    config,
    llm,
    registry,
    policy,
    new ConversationStore(config),
    ha,
    directory,
    new FastPathService(config, ha, directory, policy),
    events,
    metrics,
  );
  return { service, llm, ha, emitted, metrics };
}

describe('ConversationService', () => {
  it('answers plain questions without tools', async () => {
    const { service, llm } = setup(['<think>hmm</think>Hello there!']);
    const result = await service.converse({ text: 'Hi', speaker: 'alex' });
    expect(result.text).toBe('Hello there!');
    expect(result.principal).toMatchObject({ profile: 'adult', resolvedBy: 'speaker' });
    expect(llm.requests[0].tools?.map((t) => t.function.name)).toEqual([
      'get_time',
      'ha_list_entities',
      'ha_get_state',
      'ha_call_service',
    ]);
  });

  it('injects only exposed, readable entities into the system prompt', async () => {
    const { service, llm } = setup(['ok']);
    await service.converse({ text: 'Hi', speaker: 'alex', room: 'Kitchen' });
    const system = llm.requests[0].messages[0].content as string;
    expect(system).toContain('light.kitchen | Kitchen Light | Kitchen | off');
    expect(system).toContain('The request comes from the area "Kitchen"');
    expect(system).not.toContain('automation.secret');
  });

  it('runs tool calls and feeds results back to the model', async () => {
    const { service, llm, ha } = setup([
      [
        {
          tool: 'ha_call_service',
          args: { domain: 'light', service: 'turn_on', entity_id: 'light.kitchen' },
        },
      ],
      'The kitchen light is on.',
    ]);
    const result = await service.converse({ text: 'Make the kitchen bright', speaker: 'alex' });
    expect(ha.callService).toHaveBeenCalledWith('light', 'turn_on', {
      entity_id: ['light.kitchen'],
    });
    expect(result.actions).toEqual([
      expect.objectContaining({ tool: 'ha_call_service', status: 'ok' }),
    ]);
    expect(result.text).toBe('The kitchen light is on.');
    const toolMessage = llm.requests[1].messages.at(-1);
    expect(toolMessage).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  });

  it('enforces policy even when the model tries something forbidden', async () => {
    const { service, ha } = setup([
      [
        {
          tool: 'ha_call_service',
          args: { domain: 'light', service: 'turn_on', entity_id: 'light.kitchen' },
        },
      ],
      'Sorry, you cannot do that.',
    ]);
    const result = await service.converse({ text: 'Make the kitchen bright', room: 'Kids Room' });
    expect(ha.callService).not.toHaveBeenCalled();
    expect(result.actions[0]).toMatchObject({
      status: 'error',
      result: { error: 'not_permitted' },
    });
  });

  it('rejects targets outside the exposure list', async () => {
    const { service, ha } = setup([
      [
        {
          tool: 'ha_call_service',
          args: { domain: 'automation', service: 'turn_off', entity_id: 'automation.secret' },
        },
      ],
      'Nope.',
    ]);
    const result = await service.converse({ text: 'disable it', speaker: 'alex' });
    expect(ha.callService).not.toHaveBeenCalled();
    expect(result.actions[0].status).toBe('error');
  });

  describe('confirmations', () => {
    const unlock = [
      {
        tool: 'ha_call_service',
        args: { domain: 'lock', service: 'unlock', entity_id: 'lock.front_door' },
      },
    ];

    it('holds sensitive actions until the user says yes', async () => {
      const { service, ha } = setup([unlock]);
      const first = await service.converse({
        text: 'Unlock the front door',
        speaker: 'alex',
        conversationId: 'c1',
      });
      expect(first.pendingConfirmation).toMatchObject({ summary: 'lock.unlock → Front Door' });
      expect(first.text).toMatch(/Just to be sure/);
      expect(ha.callService).not.toHaveBeenCalled();

      const second = await service.converse({ text: 'Yes', speaker: 'alex', conversationId: 'c1' });
      expect(second.text).toBe('Done.');
      expect(ha.callService).toHaveBeenCalledWith('lock', 'unlock', {
        entity_id: ['lock.front_door'],
      });
    });

    it('cancels on no', async () => {
      const { service, ha } = setup([unlock]);
      await service.converse({
        text: 'Unlock the front door',
        speaker: 'alex',
        conversationId: 'c2',
      });
      const reply = await service.converse({ text: 'No', speaker: 'alex', conversationId: 'c2' });
      expect(reply.text).toBe('Okay, I cancelled that.');
      expect(ha.callService).not.toHaveBeenCalled();
    });

    it('drops the pending action when the user changes the subject', async () => {
      const { service, ha } = setup([unlock, 'It is sunny.']);
      await service.converse({
        text: 'Unlock the front door',
        speaker: 'alex',
        conversationId: 'c3',
      });
      const reply = await service.converse({
        text: 'How is the weather?',
        speaker: 'alex',
        conversationId: 'c3',
      });
      expect(reply.text).toBe('It is sunny.');
      expect(ha.callService).not.toHaveBeenCalled();
      const after = await service.resolvePending('c3', true);
      expect(after.text).toBe('There is nothing waiting for confirmation.');
    });

    it('can be approved via the API', async () => {
      const { service, ha } = setup([unlock]);
      await service.converse({ text: 'Unlock', speaker: 'alex', conversationId: 'c4' });
      const reply = await service.resolvePending('c4', true);
      expect(reply.text).toBe('Done.');
      expect(ha.callService).toHaveBeenCalledTimes(1);
    });
  });

  it('stops after maxToolIterations', async () => {
    const config = testConfig({ assistant: { maxToolIterations: 2, timezone: 'UTC' } });
    const loop = [{ tool: 'get_time', args: {} }];
    const { service } = setup([loop, loop, loop], config);
    const result = await service.converse({ text: 'time?', speaker: 'alex' });
    expect(result.usage.llmCalls).toBe(2);
    expect(result.text).toBe('Sorry, I could not come up with an answer.');
  });

  it('keeps short-term history per conversation', async () => {
    const { service, llm } = setup(['First answer', 'Second answer']);
    await service.converse({ text: 'one', conversationId: 'h1' });
    await service.converse({ text: 'two', conversationId: 'h1' });
    expect(llm.requests[1].messages.slice(1).map((m) => m.content)).toEqual([
      'one',
      'First answer',
      'two',
    ]);
  });
});

describe('fast path', () => {
  it('handles simple commands without the LLM', async () => {
    const { service, llm, ha } = setup([]);
    const result = await service.converse({ text: 'Turn on the kitchen light', speaker: 'alex' });
    expect(result.route).toBe('fast_path');
    expect(result.text).toBe('Kitchen Light is now on.');
    expect(llm.requests).toHaveLength(0);
    expect(ha.callService).toHaveBeenCalledWith('light', 'turn_on', {
      entity_id: ['light.kitchen'],
    });
  });

  it('answers in German and uses the request room for "Licht"', async () => {
    const config = testConfig({ assistant: { language: 'de', timezone: 'UTC' } });
    const { service, ha } = setup([], config);
    const result = await service.converse({
      text: 'Licht aus',
      speaker: 'alex',
      room: 'Kids Room',
    });
    expect(result.text).toBe('Kids Light ist jetzt aus.');
    expect(ha.callService).toHaveBeenCalledWith('light', 'turn_off', { entity_id: ['light.kids'] });
  });

  it('enforces policy deterministically', async () => {
    const { service, ha, llm } = setup([]);
    const result = await service.converse({ text: 'Turn on the kitchen light', room: 'Kids Room' });
    expect(result.route).toBe('fast_path');
    expect(result.text).toBe("Sorry, you're not allowed to do that.");
    expect(ha.callService).not.toHaveBeenCalled();
    expect(llm.requests).toHaveLength(0);
  });

  it('falls back to the LLM when the target is unclear', async () => {
    const { service, llm } = setup(['Which one?']);
    const result = await service.converse({ text: 'Turn on the lights', speaker: 'alex' });
    expect(result.route).toBe('llm');
    expect(llm.requests).toHaveLength(1);
  });

  it('can be disabled', async () => {
    const config = testConfig({ fastPath: { enabled: false } });
    const { service } = setup(['ok'], config);
    expect(
      (await service.converse({ text: 'Turn on the kitchen light', speaker: 'alex' })).route,
    ).toBe('llm');
  });
});

describe('languages', () => {
  const unlock = [
    {
      tool: 'ha_call_service',
      args: { domain: 'lock', service: 'unlock', entity_id: 'lock.front_door' },
    },
  ];
  const systemPrompt = (llm: { requests: { messages: { content: string | null }[] }[] }, i = 0) =>
    llm.requests[i].messages[0].content as string;

  it('answers fast-path commands in the language they were spoken in', async () => {
    const { service } = setup([]); // configured language: en
    const de = await service.converse({ text: 'Licht aus', speaker: 'alex', room: 'Kids Room' });
    expect(de).toMatchObject({ language: 'de', text: 'Kids Light ist jetzt aus.' });
    const en = await service.converse({ text: 'Turn on the kitchen light', speaker: 'alex' });
    expect(en).toMatchObject({ language: 'en', text: 'Kitchen Light is now on.' });
  });

  it('accepts a German "ja" to an English confirmation question', async () => {
    const { service, ha } = setup([unlock]);
    const ask = await service.converse({
      text: 'Unlock the front door',
      speaker: 'alex',
      conversationId: 'l1',
    });
    expect(ask.text).toMatch(/^Just to be sure/);
    const reply = await service.converse({ text: 'Ja', speaker: 'alex', conversationId: 'l1' });
    expect(reply).toMatchObject({ text: 'Erledigt.', language: 'de' });
    expect(ha.callService).toHaveBeenCalledTimes(1);
  });

  it('tells the model which language to answer in', async () => {
    const config = testConfig({ assistant: { language: 'de', timezone: 'UTC' } });
    const { service, llm } = setup(['It is sunny.'], config);
    await service.converse({ text: 'What is the weather like today?', speaker: 'alex' });
    expect(systemPrompt(llm)).toContain('The user is speaking English. Answer in English.');
  });

  it('keeps the previous language when an utterance gives no signal', async () => {
    const { service, llm } = setup(['Gerne.', 'Okay.']);
    await service.converse({
      text: 'Wie ist das Wetter heute?',
      speaker: 'alex',
      conversationId: 'l2',
    });
    const result = await service.converse({ text: 'OK', speaker: 'alex', conversationId: 'l2' });
    expect(result.language).toBe('de');
    expect(systemPrompt(llm, 1)).toContain('If unclear, use German.');
  });

  it('can be switched off', async () => {
    const config = testConfig({ assistant: { detectLanguage: false, timezone: 'UTC' } });
    const { service } = setup([], config);
    const result = await service.converse({
      text: 'Licht aus',
      speaker: 'alex',
      room: 'Kids Room',
    });
    expect(result).toMatchObject({ language: 'en', text: 'Kids Light is now off.' });
  });

  it('honours an explicit language from the client', async () => {
    const { service } = setup([]);
    const result = await service.converse({
      text: 'Licht aus',
      speaker: 'alex',
      room: 'Kids Room',
      language: 'en',
    });
    expect(result.text).toBe('Kids Light is now off.');
  });
});

describe('events & metrics', () => {
  it('emits lifecycle events and records metrics', async () => {
    const { service, emitted, metrics } = setup([]);
    await service.converse({
      text: 'Turn on the kitchen light',
      speaker: 'alex',
      room: 'Kitchen',
      conversationId: 'e1',
    });
    expect(emitted.map((e) => e.type)).toEqual([
      'conversation.started',
      'tool.executed',
      'conversation.answered',
    ]);
    expect(emitted.at(-1)).toMatchObject({
      conversationId: 'e1',
      room: 'Kitchen',
      data: { text: 'Kitchen Light is now on.', route: 'fast_path' },
    });
    const text = await metrics.registry.metrics();
    expect(text).toContain('aura_conversations_total{route="fast_path",profile="adult"} 1');
  });

  it('emits confirmation events', async () => {
    const unlock = [
      {
        tool: 'ha_call_service',
        args: { domain: 'lock', service: 'unlock', entity_id: 'lock.front_door' },
      },
    ];
    const { service, emitted } = setup([unlock]);
    await service.converse({ text: 'Unlock the door', speaker: 'alex', conversationId: 'e2' });
    await service.converse({ text: 'yes', speaker: 'alex', conversationId: 'e2' });
    const types = emitted.map((e) => e.type);
    expect(types).toContain('confirmation.requested');
    expect(emitted.find((e) => e.type === 'confirmation.resolved')?.data).toEqual({
      outcome: 'approved',
    });
  });
});

describe('stripThinking', () => {
  it('removes reasoning blocks', () => {
    expect(stripThinking('<think>a\nb</think>Answer')).toBe('Answer');
    expect(stripThinking('dangling</think>Answer')).toBe('Answer');
    expect(stripThinking('Plain')).toBe('Plain');
  });
});
