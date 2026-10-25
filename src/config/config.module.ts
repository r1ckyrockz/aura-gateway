import { Global, Logger, Module, type DynamicModule } from '@nestjs/common';
import type { AuraConfig } from './aura-config.schema';
import type { Env } from './env.schema';
import { loadConfig, type LoadedConfig } from './load-config';

export const AURA_CONFIG = Symbol('AURA_CONFIG');
export const AURA_ENV = Symbol('AURA_ENV');

@Global()
@Module({})
export class AuraConfigModule {
  static forRoot(config?: LoadedConfig): DynamicModule {
    const loaded = config ?? loadConfig();
    const logger = new Logger('Config');
    logger.log(
      loaded.source
        ? `Loaded config from ${loaded.source}`
        : 'No config file found, using defaults',
    );
    return {
      module: AuraConfigModule,
      providers: [
        { provide: AURA_CONFIG, useValue: loaded.aura satisfies AuraConfig },
        { provide: AURA_ENV, useValue: loaded.env satisfies Env },
      ],
      exports: [AURA_CONFIG, AURA_ENV],
    };
  }
}
