import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { errorMessage } from '../common/errors';
import type { ToolDefinition } from '../llm/llm.types';
import {
  AURA_TOOLS,
  result,
  type AuraTool,
  type ToolContext,
  type ToolOutcome,
} from './tool.types';

/** Collects all registered tools, renders their JSON schemas and executes calls safely. */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, AuraTool>();

  constructor(@Inject(AURA_TOOLS) tools: AuraTool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      this.tools.set(tool.name, tool);
    }
  }

  available(): AuraTool[] {
    return [...this.tools.values()].filter((tool) => tool.isAvailable());
  }

  definitions(): ToolDefinition[] {
    return this.available().map((tool) => {
      const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.schema, {
        io: 'input',
      }) as Record<string, unknown>;
      return {
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters },
      };
    });
  }

  /** Never throws — errors become tool results so the model can recover or explain. */
  async run(name: string, rawArguments: string, context: ToolContext): Promise<ToolOutcome> {
    const tool = this.tools.get(name);
    if (!tool || !tool.isAvailable()) return result({ error: `Unknown tool: ${name}` });

    let parsedJson: unknown;
    try {
      parsedJson = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    } catch {
      return result({ error: 'Arguments must be valid JSON' });
    }
    const args = tool.schema.safeParse(parsedJson);
    if (!args.success) {
      return result({
        error: 'Invalid arguments',
        issues: args.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      });
    }
    try {
      return await tool.execute(args.data, context);
    } catch (error) {
      this.logger.warn(`Tool ${name} failed: ${errorMessage(error)}`);
      return result({ error: errorMessage(error) });
    }
  }
}
