import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { ConfigError, loadConfig } from './config/load-config';
import { version } from './version';

async function main() {
  const logger = new Logger('AURA');
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const app = await createApp(config);
  const { AURA_HOST, AURA_PORT, LLM_BASE_URL, LLM_MODEL, HA_URL } = config.env;
  await app.listen(AURA_PORT, AURA_HOST);
  logger.log(`AURA Gateway v${version} listening on http://${AURA_HOST}:${AURA_PORT}`);
  logger.log(`LLM: ${LLM_MODEL} @ ${LLM_BASE_URL}`);
  logger.log(`Home Assistant: ${HA_URL ?? 'not configured'}`);
}

void main();
