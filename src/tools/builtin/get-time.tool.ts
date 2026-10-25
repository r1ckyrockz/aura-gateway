import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { result, type AuraTool, type ToolContext } from '../tool.types';

const schema = z.object({});

@Injectable()
export class GetTimeTool implements AuraTool<typeof schema> {
  readonly name = 'get_time';
  readonly description = 'Get the current local date and time.';
  readonly schema = schema;

  isAvailable() {
    return true;
  }

  async execute(_args: z.infer<typeof schema>, { language, timezone }: ToolContext) {
    const now = new Date();
    return result({
      iso: now.toISOString(),
      timezone,
      local: new Intl.DateTimeFormat(language, {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(now),
    });
  }
}
