import type { z, ZodType } from 'zod';
import type { Principal } from '../policy/policy.types';

export const AURA_TOOLS = Symbol('AURA_TOOLS');

export interface ToolContext {
  principal: Principal;
  conversationId: string;
  language: string;
  timezone: string;
}

/** An action that is held back until the user explicitly confirms it. */
export interface PendingAction {
  id: string;
  tool: string;
  /** Human-readable summary, e.g. "unlock Front Door". */
  summary: string;
  run: () => Promise<unknown>;
}

export type ToolOutcome =
  { kind: 'result'; data: unknown } | { kind: 'confirmation_required'; action: PendingAction };

/**
 * A capability the model can call. Implement this interface and register the class
 * under the `AURA_TOOLS` token to add your own tools.
 */
export interface AuraTool<S extends ZodType = ZodType> {
  readonly name: string;
  readonly description: string;
  readonly schema: S;
  isAvailable(): boolean;
  execute(args: z.infer<S>, context: ToolContext): Promise<ToolOutcome>;
}

export const result = (data: unknown): ToolOutcome => ({ kind: 'result', data });
