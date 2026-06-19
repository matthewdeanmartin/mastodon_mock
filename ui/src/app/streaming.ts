import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Auth } from './auth';

/** A parsed SSE event from a `/api/v1/streaming/*` channel. */
export interface StreamEvent {
  event: string;
  payload: unknown;
}

export type StreamKind =
  | { stream: 'user' }
  | { stream: 'public'; local?: boolean }
  | { stream: 'hashtag'; tag: string; local?: boolean }
  | { stream: 'list'; list: string }
  | { stream: 'direct' };

/**
 * Thin wrapper over `EventSource` for `/api/v1/streaming`. The access token travels
 * as a query param because `EventSource` cannot set an `Authorization` header (see
 * mastodon_mock/routers/streaming.py's `_account_from_query_token`).
 */
@Injectable({ providedIn: 'root' })
export class Streaming {
  private auth = inject(Auth);

  open(kind: StreamKind): Observable<StreamEvent> {
    return new Observable<StreamEvent>((subscriber) => {
      const url = this.buildUrl(kind);
      const source = new EventSource(url);

      const forward = (name: string) => (ev: MessageEvent) => {
        // `delete` sends a bare status id string, not JSON — JSON.parse would
        // silently coerce a numeric-looking id (e.g. "123") to a number.
        const payload: unknown = name === 'delete' ? ev.data : JSON.parse(ev.data);
        subscriber.next({ event: name, payload });
      };

      const events = ['update', 'status_update', 'delete', 'notification', 'conversation'];
      for (const name of events) {
        source.addEventListener(name, forward(name));
      }
      source.onerror = () => {
        // EventSource auto-reconnects; surface nothing unless the caller unsubscribes.
      };

      return () => source.close();
    });
  }

  private buildUrl(kind: StreamKind): string {
    const params = new URLSearchParams();
    const token = this.auth.token();
    if (token) {
      params.set('access_token', token);
    }
    params.set(
      'stream',
      kind.stream === 'hashtag' && kind.local ? 'hashtag:local' : this.streamParam(kind),
    );
    if (kind.stream === 'hashtag') {
      params.set('tag', kind.tag);
    }
    if (kind.stream === 'list') {
      params.set('list', kind.list);
    }
    return `/api/v1/streaming?${params.toString()}`;
  }

  private streamParam(kind: StreamKind): string {
    switch (kind.stream) {
      case 'user':
        return 'user';
      case 'public':
        return kind.local ? 'public:local' : 'public';
      case 'hashtag':
        return 'hashtag';
      case 'list':
        return 'list';
      case 'direct':
        return 'direct';
    }
  }
}
