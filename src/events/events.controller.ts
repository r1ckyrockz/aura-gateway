import { Controller, Query, Sse, type MessageEvent } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { interval, map, merge, type Observable } from 'rxjs';
import { AllowQueryToken } from '../common/public.decorator';
import { EventBus, type AuraEventType } from './event-bus.service';

const HEARTBEAT_MS = 25_000;

@ApiTags('events')
@ApiBearerAuth()
@Controller('v1/events')
export class EventsController {
  constructor(private readonly bus: EventBus) {}

  @Sse()
  @AllowQueryToken()
  @ApiOperation({
    summary: 'Server-Sent Events stream of conversation lifecycle events',
    description:
      'For satellites and displays. Browsers (EventSource) cannot send headers, so `?access_token=` is accepted here.',
  })
  @ApiQuery({ name: 'room', required: false })
  @ApiQuery({ name: 'conversationId', required: false })
  @ApiQuery({ name: 'types', required: false, description: 'Comma-separated event types' })
  stream(
    @Query('room') room?: string,
    @Query('conversationId') conversationId?: string,
    @Query('types') types?: string,
  ): Observable<MessageEvent> {
    const typeList = types
      ?.split(',')
      .map((t) => t.trim())
      .filter(Boolean) as AuraEventType[] | undefined;
    const events = this.bus
      .stream({ room, conversationId, types: typeList?.length ? typeList : undefined })
      .pipe(map((event): MessageEvent => ({ type: event.type, data: event })));
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } })),
    );
    return merge(events, heartbeat);
  }
}
