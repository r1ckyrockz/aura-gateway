import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import type { LoadedConfig } from './config/load-config';
import { version } from './version';

/** Creates and configures the Nest application (shared by main.ts and e2e tests). */
export async function createApp(config: LoadedConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: false,
  });
  app.set('trust proxy', 'loopback');
  app.enableShutdownHooks();

  if (config.env.AURA_ENABLE_DOCS) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AURA Gateway')
        .setDescription(
          'Local-first brain API for AURA — voice, LLM and Home Assistant in one place.',
        )
        .setVersion(version)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
  return app;
}
