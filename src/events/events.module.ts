import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus.service';
import { EventsController } from './events.controller';

@Global()
@Module({ providers: [EventBus], controllers: [EventsController], exports: [EventBus] })
export class EventsModule {}
