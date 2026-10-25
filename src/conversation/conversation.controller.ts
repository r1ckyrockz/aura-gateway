import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../common/api-key.guard';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { EntityDirectory } from '../home-assistant/entity-directory.service';
import { HomeAssistantClient } from '../home-assistant/ha.client';
import { PolicyService } from '../policy/policy.service';
import { ToolRegistry } from '../tools/tool-registry.service';
import {
  confirmSchema,
  converseSchema,
  type ConfirmDto,
  type ConverseDto,
} from './conversation.dto';
import { ConversationService } from './conversation.service';

const openApi = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input' }) as unknown as SchemaObject;

@ApiTags('conversation')
@ApiBearerAuth()
@Controller('v1')
export class ConversationController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly tools: ToolRegistry,
    private readonly policy: PolicyService,
    private readonly ha: HomeAssistantClient,
    private readonly directory: EntityDirectory,
  ) {}

  @Post('conversation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send an utterance to AURA and get a speakable answer' })
  @ApiBody({ schema: openApi(converseSchema) })
  converse(
    @Body(new ZodBodyPipe(converseSchema)) body: ConverseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conversations.converse({ ...body, client: req.auraClient });
  }

  @Post('conversation/:id/confirmation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject an action that is waiting for confirmation' })
  @ApiBody({ schema: openApi(confirmSchema) })
  confirm(@Param('id') id: string, @Body(new ZodBodyPipe(confirmSchema)) body: ConfirmDto) {
    return this.conversations.resolvePending(id, body.approve, body.language);
  }

  @Get('tools')
  @ApiOperation({ summary: 'List the tools currently offered to the model' })
  listTools() {
    return { tools: this.tools.definitions().map((d) => d.function) };
  }

  @Get('entities')
  @ApiOperation({ summary: 'Entities visible to a given speaker/room (debugging your policy)' })
  async listEntities(
    @Req() req: AuthenticatedRequest,
    @Query('speaker') speaker?: string,
    @Query('room') room?: string,
  ) {
    const principal = this.policy.resolve({ speaker, room, client: req.auraClient });
    if (!this.ha.enabled) return { profile: principal.profileName, entities: [] };
    const entities = (await this.directory.list())
      .filter((e) => this.policy.canRead(principal, e))
      .map((e) => {
        const decision = this.policy.canControl(principal, e);
        return {
          entity_id: e.entityId,
          name: e.name,
          area: e.area,
          state: e.state,
          controllable: decision.allowed,
          requiresConfirmation: decision.allowed && decision.requiresConfirmation,
        };
      });
    return { profile: principal.profileName, resolvedBy: principal.resolvedBy, entities };
  }
}
