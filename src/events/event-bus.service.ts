import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { filter, Subject, type Observable } from 'rxjs';
import { normalizeArea } from '../policy/policy.service';

export type AuraEventType =
  | 'conversation.started'
  | 'conversation.answered'
  | 'tool.executed'
  | 'confirmation.requested'
  | 'confirmation.resolved';

/** Lifecycle event for satellites, displays and dashboards (e.g. "thinking", "speaking"). */
export interface AuraEvent {
  type: AuraEventType;
  conversationId: string;
  room?: string;
  speaker?: string;
  at: string;
  data?: Record<string, unknown>;
}

export interface EventFilter {
  room?: string;
  conversationId?: string;
  types?: AuraEventType[];
}

/** In-process pub/sub. Events are fire-and-forget and never persisted. */
@Injectable()
export class EventBus implements OnModuleDestroy {
  private readonly subject = new Subject<AuraEvent>();

  emit(event: Omit<AuraEvent, 'at'>): void {
    this.subject.next({ ...event, at: new Date().toISOString() });
  }

  stream({ room, conversationId, types }: EventFilter = {}): Observable<AuraEvent> {
    const wantedRoom = room ? normalizeArea(room) : undefined;
    return this.subject
      .asObservable()
      .pipe(
        filter(
          (event) =>
            (!wantedRoom ||
              (event.room !== undefined && normalizeArea(event.room) === wantedRoom)) &&
            (!conversationId || event.conversationId === conversationId) &&
            (!types || types.includes(event.type)),
        ),
      );
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
