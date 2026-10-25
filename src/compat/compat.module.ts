import { Module, type DynamicModule } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { OllamaController } from './ollama.controller';
import { OpenAiController } from './openai.controller';

@Module({})
export class CompatModule {
  static register({ ollama }: { ollama: boolean }): DynamicModule {
    return {
      module: CompatModule,
      imports: [ConversationModule],
      controllers: [OpenAiController, ...(ollama ? [OllamaController] : [])],
    };
  }
}
