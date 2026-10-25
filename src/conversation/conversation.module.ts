import { Module } from '@nestjs/common';
import { HomeAssistantModule } from '../home-assistant/ha.module';
import { LlmModule } from '../llm/llm.module';
import { PolicyModule } from '../policy/policy.module';
import { ToolsModule } from '../tools/tools.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ConversationStore } from './conversation.store';
import { FastPathService } from './fast-path.service';

@Module({
  imports: [LlmModule, ToolsModule, PolicyModule, HomeAssistantModule],
  controllers: [ConversationController],
  providers: [ConversationService, ConversationStore, FastPathService],
  exports: [ConversationService],
})
export class ConversationModule {}
