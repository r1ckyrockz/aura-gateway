import { Module } from '@nestjs/common';
import { LlmClient } from './llm.types';
import { OpenAiCompatibleClient } from './openai-compatible.client';

@Module({
  providers: [{ provide: LlmClient, useClass: OpenAiCompatibleClient }],
  exports: [LlmClient],
})
export class LlmModule {}
