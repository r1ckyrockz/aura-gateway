import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { errorMessage } from '../common/errors';
import { Public } from '../common/public.decorator';
import { HomeAssistantClient } from '../home-assistant/ha.client';
import { LlmClient } from '../llm/llm.types';
import { version } from '../version';

type Check = { status: 'up' | 'down' | 'disabled'; error?: string; latencyMs?: number };

async function probe(fn: () => Promise<unknown>): Promise<Check> {
  const started = Date.now();
  try {
    await fn();
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (error) {
    return { status: 'down', error: errorMessage(error), latencyMs: Date.now() - started };
  }
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly llm: LlmClient,
    private readonly ha: HomeAssistantClient,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok', version };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks the LLM server and Home Assistant' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [llm, homeAssistant] = await Promise.all([
      probe(() => this.llm.ping()),
      this.ha.enabled
        ? probe(() => this.ha.ping())
        : Promise.resolve<Check>({ status: 'disabled' }),
    ]);
    const ok = llm.status === 'up' && homeAssistant.status !== 'down';
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', version, checks: { llm, homeAssistant } };
  }
}
