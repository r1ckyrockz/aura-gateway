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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../common/api-key.guard';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { ConversationService } from '../conversation/conversation.service';
import { AURA_MODEL, auraHeaders, conversationIdFor, splitTranscript } from './compat.util';

const chatSchema = z
  .object({
    model: z.string().optional(),
    messages: z
      .array(z.object({ role: z.string(), content: z.unknown().optional() }).loose())
      .min(1),
    stream: z.boolean().optional(),
    user: z.string().optional(),
  })
  .loose();
type ChatBody = z.infer<typeof chatSchema>;

/**
 * OpenAI-compatible facade so any OpenAI client (Open WebUI, HA custom integrations, scripts)
 * can talk to AURA as the model "aura". Tools sent by the client are ignored.
 */
@ApiTags('openai-compatible')
@ApiBearerAuth()
@Controller('v1')
export class OpenAiController {
  constructor(private readonly conversations: ConversationService) {}

  @Get('models')
  @ApiOperation({ summary: 'OpenAI-compatible model list' })
  models() {
    return {
      object: 'list',
      data: [{ id: AURA_MODEL, object: 'model', created: 0, owned_by: 'aura-gateway' }],
    };
  }

  @Post('chat/completions')
  @HttpCode(200)
  @ApiOperation({ summary: 'OpenAI-compatible chat completion backed by AURA' })
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
      conversationId: conversationIdFor(req, body.messages, body.user),
      client: req.auraClient,
      ...auraHeaders(req),
    });
    res.setHeader('x-aura-conversation-id', result.conversationId);

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = body.model ?? AURA_MODEL;

    if (body.stream) {
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: 'assistant' }, null));
      res.write(chunk({ content: result.text }, null));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
      return;
    }

    return {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        { index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' },
      ],
      usage: {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.promptTokens + result.usage.completionTokens,
      },
      aura: {
        conversation_id: result.conversationId,
        actions: result.actions,
        pending_confirmation: result.pendingConfirmation,
      },
    };
  }
}
