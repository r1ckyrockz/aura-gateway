import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './common/api-key.guard';
import { UpstreamErrorFilter } from './common/upstream-error.filter';
import { CompatModule } from './compat/compat.module';
import { AuraConfigModule } from './config/config.module';
import { loadConfig, type LoadedConfig } from './config/load-config';
import { ConversationModule } from './conversation/conversation.module';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static forRoot(config: LoadedConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AuraConfigModule.forRoot(config),
        HealthModule,
        ConversationModule,
        CompatModule.register({ ollama: config.env.AURA_OLLAMA_COMPAT }),
      ],
      providers: [
        { provide: APP_GUARD, useClass: ApiKeyGuard },
        { provide: APP_FILTER, useClass: UpstreamErrorFilter },
      ],
    };
  }
}
