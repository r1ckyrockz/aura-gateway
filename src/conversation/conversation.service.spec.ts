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
  const service = new ConversationService(
    config,
    llm,
    registry,
    policy,
    new ConversationStore(config),
    ha,
    directory,
  );
  return { service, llm, ha };
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
    const result = await service.converse({ text: 'Kitchen light on', speaker: 'alex' });
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
    const result = await service.converse({ text: 'Kitchen light on', room: 'Kids Room' });
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

describe('stripThinking', () => {
  it('removes reasoning blocks', () => {
    expect(stripThinking('<think>a\nb</think>Answer')).toBe('Answer');
    expect(stripThinking('dangling</think>Answer')).toBe('Answer');
    expect(stripThinking('Plain')).toBe('Plain');
  });
});
