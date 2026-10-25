import { Module } from '@nestjs/common';
import { EntityDirectory } from './entity-directory.service';
import { HomeAssistantClient } from './ha.client';

@Module({
  providers: [HomeAssistantClient, EntityDirectory],
  exports: [HomeAssistantClient, EntityDirectory],
})
export class HomeAssistantModule {}
