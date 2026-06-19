import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from './auth';
import { Streaming } from './streaming';

/** Minimal fake standing in for the browser's EventSource. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  closed = false;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (ev: MessageEvent) => void): void {
    (this.listeners.get(name) ?? this.listeners.set(name, []).get(name)!).push(fn);
  }

  emit(name: string, data: string): void {
    for (const fn of this.listeners.get(name) ?? []) {
      fn({ data } as MessageEvent);
    }
  }

  close(): void {
    this.closed = true;
  }
}

describe('Streaming', () => {
  let streaming: Streaming;
  let auth: Auth;
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    // @ts-expect-error -- test double, not a full EventSource implementation
    globalThis.EventSource = FakeEventSource;

    TestBed.configureTestingModule({});
    streaming = TestBed.inject(Streaming);
    auth = TestBed.inject(Auth);
    auth.setToken('test-token-123');
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  function lastSource(): FakeEventSource {
    return FakeEventSource.instances.at(-1)!;
  }

  it('builds the user-stream URL with the access token and stream param', () => {
    const sub = streaming.open({ stream: 'user' }).subscribe();
    const url = new URL(lastSource().url, 'http://localhost');
    expect(url.pathname).toBe('/api/v1/streaming');
    expect(url.searchParams.get('access_token')).toBe('test-token-123');
    expect(url.searchParams.get('stream')).toBe('user');
    sub.unsubscribe();
  });

  it('maps public (non-local) to stream=public', () => {
    const sub = streaming.open({ stream: 'public' }).subscribe();
    const url = new URL(lastSource().url, 'http://localhost');
    expect(url.searchParams.get('stream')).toBe('public');
    sub.unsubscribe();
  });

  it('maps public+local to stream=public:local', () => {
    const sub = streaming.open({ stream: 'public', local: true }).subscribe();
    const url = new URL(lastSource().url, 'http://localhost');
    expect(url.searchParams.get('stream')).toBe('public:local');
    sub.unsubscribe();
  });

  it('maps hashtag to stream=hashtag with a tag param', () => {
    const sub = streaming.open({ stream: 'hashtag', tag: 'CatsOfMastodon' }).subscribe();
    const url = new URL(lastSource().url, 'http://localhost');
    expect(url.searchParams.get('stream')).toBe('hashtag');
    expect(url.searchParams.get('tag')).toBe('CatsOfMastodon');
    sub.unsubscribe();
  });

  it('maps local hashtag to stream=hashtag:local', () => {
    const sub = streaming.open({ stream: 'hashtag', tag: 'art', local: true }).subscribe();
    const url = new URL(lastSource().url, 'http://localhost');
    expect(url.searchParams.get('stream')).toBe('hashtag:local');
    sub.unsubscribe();
  });

  it('maps list to stream=list with a list param', () => {
    const sub = streaming.open({ stream: 'list', list: '42' }).subscribe();
    const url = new URL(lastSource().url, 'http://localhost');
    expect(url.searchParams.get('stream')).toBe('list');
    expect(url.searchParams.get('list')).toBe('42');
    sub.unsubscribe();
  });

  it('maps direct to stream=direct', () => {
    const sub = streaming.open({ stream: 'direct' }).subscribe();
    const url = new URL(lastSource().url, 'http://localhost');
    expect(url.searchParams.get('stream')).toBe('direct');
    sub.unsubscribe();
  });

  it('omits access_token when not authenticated', () => {
    auth.logout();
    const sub = streaming.open({ stream: 'user' }).subscribe();
    const url = new URL(lastSource().url, 'http://localhost');
    expect(url.searchParams.has('access_token')).toBe(false);
    sub.unsubscribe();
  });

  it('parses JSON event payloads', () => {
    const received: unknown[] = [];
    const sub = streaming.open({ stream: 'user' }).subscribe((ev) => received.push(ev));
    lastSource().emit('update', '{"id":"123","content":"hi"}');
    expect(received).toEqual([{ event: 'update', payload: { id: '123', content: 'hi' } }]);
    sub.unsubscribe();
  });

  it('passes through non-JSON payloads as a bare string (e.g. delete)', () => {
    const received: unknown[] = [];
    const sub = streaming.open({ stream: 'user' }).subscribe((ev) => received.push(ev));
    lastSource().emit('delete', '123456');
    expect(received).toEqual([{ event: 'delete', payload: '123456' }]);
    sub.unsubscribe();
  });

  it('closes the underlying EventSource on unsubscribe', () => {
    const sub = streaming.open({ stream: 'user' }).subscribe();
    const source = lastSource();
    expect(source.closed).toBe(false);
    sub.unsubscribe();
    expect(source.closed).toBe(true);
  });

  it('opens a fresh EventSource per subscription', () => {
    const obs = streaming.open({ stream: 'public' });
    const sub1 = obs.subscribe();
    const sub2 = obs.subscribe();
    expect(FakeEventSource.instances.length).toBe(2);
    sub1.unsubscribe();
    sub2.unsubscribe();
  });
});
