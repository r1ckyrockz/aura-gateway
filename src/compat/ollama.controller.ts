import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../common/api-key.guard';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { ConversationService } from '../conversation/conversation.service';
import { AURA_MODEL, auraHeaders, conversationIdFor, splitTranscript } from './compat.util';

const MODEL_TAG = `${AURA_MODEL}:latest`;
const chatSchema = z
  .object({
    model: z.string().optional(),
    messages: z
      .array(z.object({ role: z.string(), content: z.unknown().optional() }).loose())
      .min(1),
    stream: z.boolean().optional(),
  })
  .loose();
type ChatBody = z.infer<typeof chatSchema>;

const details = {
  format: 'gguf',
  family: 'aura',
  families: ['aura'],
  parameter_size: 'n/a',
  quantization_level: 'n/a',
};

/**
 * Experimental Ollama-compatible facade. Lets Home Assistant's built-in Ollama integration use
 * AURA as its conversation agent — no custom component needed. Disable with AURA_OLLAMA_COMPAT=false.
 */
@ApiTags('ollama-compatible')
@Controller('api')
export class OllamaController {
  constructor(private readonly conversations: ConversationService) {}

  @Get('version')
  version() {
    return { version: '0.6.0' };
  }

  @Get('tags')
  @ApiOperation({ summary: 'Ollama-compatible model list' })
  tags() {
    return {
      models: [
        {
          name: MODEL_TAG,
          model: MODEL_TAG,
          modified_at: new Date(0).toISOString(),
          size: 0,
          digest: 'aura',
          details,
        },
      ],
    };
  }

  @Post('show')
  @HttpCode(200)
  show() {
    return {
      modelfile: '',
      parameters: '',
      template: '',
      details,
      model_info: {},
      capabilities: ['completion', 'tools'],
    };
  }

  @Post('chat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ollama-compatible chat backed by AURA' })
  async chat(
    @Body(new ZodBodyPipe(chatSchema)) body: ChatBody,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { history, text } = splitTranscript(body.messages);
    if (!text) throw new BadRequestException('No user message found');

    const result = await this.conversations.converse({
      text,
      history,
      conversationId: conversationIdFor(req, body.messages),
      client: req.auraClient,
      ...auraHeaders(req),
    });

    const model = body.model ?? MODEL_TAG;
    const createdAt = new Date().toISOString();
    const message = { role: 'assistant', content: result.text };
    const done = {
      model,
      created_at: createdAt,
      done: true,
      done_reason: 'stop',
      prompt_eval_count: result.usage.promptTokens,
      eval_count: result.usage.completionTokens,
    };

    // Ollama streams by default (NDJSON).
    if (body.stream !== false) {
      res.setHeader('content-type', 'application/x-ndjson');
      res.write(`${JSON.stringify({ model, created_at: createdAt, message, done: false })}\n`);
      res.end(`${JSON.stringify({ ...done, message: { role: 'assistant', content: '' } })}\n`);
      return;
    }
    return { ...done, message };
  }
}
