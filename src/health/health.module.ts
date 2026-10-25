import { Module } from '@nestjs/common';
import { HomeAssistantModule } from '../home-assistant/ha.module';
import { LlmModule } from '../llm/llm.module';
import { HealthController } from './health.controller';

@Module({ imports: [LlmModule, HomeAssistantModule], controllers: [HealthController] })
export class HealthModule {}
