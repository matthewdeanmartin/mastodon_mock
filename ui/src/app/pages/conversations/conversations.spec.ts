import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conversation, Status } from '../../models';
import { Conversations } from './conversations';

interface ConversationsInternals {
  conversations: WritableSignal<Conversation[]>;
  loading: WritableSignal<boolean>;
  selectedId: WritableSignal<string | null>;
  selected: Signal<Conversation | null>;
  replyMentions: Signal<string>;
  replyToId: Signal<string | undefined>;
}

function internals(fixture: ComponentFixture<Conversations>): ConversationsInternals {
  return fixture.componentInstance as unknown as ConversationsInternals;
}

function makeAccount(id: string, acct = `user${id}`, display_name = `User ${id}`) {
  return {
    id,
    username: acct,
    acct,
    display_name,
    note: '',
    url: '',
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    fields: [],
  };
}

function makeStatus(id: string): Status {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'direct',
    url: null,
    account: makeAccount('1') as never,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
  };
}

function makeConversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return { id, unread: false, accounts: [], last_status: null, ...overrides };
}

describe('Conversations', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(conversations: Conversation[] = []): ComponentFixture<Conversations> {
    const fixture = TestBed.createComponent(Conversations);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/v1/conversations').flush(conversations);
    return fixture;
  }

  // ---------------------------------------------------------------- initial load

  it('fetches conversations on init and clears loading', () => {
    const fixture = TestBed.createComponent(Conversations);
    fixture.detectChanges();

    expect(internals(fixture).loading()).toBe(true);

    httpMock.expectOne((r) => r.url === '/api/v1/conversations').flush([makeConversation('1')]);

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).conversations()).toHaveLength(1);
  });

  it('clears loading on HTTP error', () => {
    const fixture = TestBed.createComponent(Conversations);
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url === '/api/v1/conversations')
      .flush('', { status: 500, statusText: 'Error' });

    expect(internals(fixture).loading()).toBe(false);
  });

  // ---------------------------------------------------------------- select

  it('select: sets the selectedId and does not call markRead for already-read convs', () => {
    const conv = makeConversation('c1', { unread: false });
    const fixture = setUp([conv]);

    fixture.componentInstance.select(conv);
    expect(internals(fixture).selectedId()).toBe('c1');
    // No extra HTTP request for mark-read.
    httpMock.expectNone('/api/v1/conversations/c1/read');
  });

  it('select: calls markRead and POSTs for unread conversations', () => {
    const conv = makeConversation('c2', { unread: true });
    const fixture = setUp([conv]);

    fixture.componentInstance.select(conv);

    const req = httpMock.expectOne('/api/v1/conversations/c2/read');
    expect(req.request.method).toBe('POST');
    req.flush({ ...conv, unread: false });

    // Should optimistically mark it as read locally.
    expect(internals(fixture).conversations()[0].unread).toBe(false);
  });

  // ---------------------------------------------------------------- selected / replyMentions computed

  it('selected() returns null when nothing is selected', () => {
    const fixture = setUp([makeConversation('c1')]);
    expect(internals(fixture).selected()).toBeNull();
  });

  it('selected() returns the matching conversation', () => {
    const c1 = makeConversation('c1');
    const c2 = makeConversation('c2');
    const fixture = setUp([c1, c2]);

    internals(fixture).selectedId.set('c2');
    expect(internals(fixture).selected()?.id).toBe('c2');
  });

  it('replyMentions: returns empty string when no conversation is selected', () => {
    const fixture = setUp([]);
    expect(internals(fixture).replyMentions()).toBe('');
  });

  it('replyMentions: returns @mention string for selected conversation participants', () => {
    const conv = makeConversation('c1', {
      accounts: [makeAccount('2', 'alice'), makeAccount('3', 'bob')] as never,
    });
    const fixture = setUp([conv]);
    internals(fixture).selectedId.set('c1');

    expect(internals(fixture).replyMentions()).toBe('@alice @bob ');
  });

  it('replyToId: returns the last_status id of the selected conversation', () => {
    const status = makeStatus('s1');
    const conv = makeConversation('c1', { last_status: status });
    const fixture = setUp([conv]);
    internals(fixture).selectedId.set('c1');

    expect(internals(fixture).replyToId()).toBe('s1');
  });

  // ---------------------------------------------------------------- title()

  it('title: returns participant display names joined by comma', () => {
    const conv = makeConversation('c1', {
      accounts: [makeAccount('2', 'alice', 'Alice A'), makeAccount('3', 'bob', 'Bob B')] as never,
    });
    const fixture = setUp([conv]);
    expect(fixture.componentInstance.title(conv)).toBe('Alice A, Bob B');
  });

  it('title: uses username when display_name is empty', () => {
    const conv = makeConversation('c1', {
      accounts: [makeAccount('2', 'alice', '')] as never,
    });
    const fixture = setUp([conv]);
    expect(fixture.componentInstance.title(conv)).toBe('alice');
  });

  it('title: returns "You" for a self-conversation with no accounts', () => {
    const conv = makeConversation('c1', { accounts: [] });
    const fixture = setUp([conv]);
    expect(fixture.componentInstance.title(conv)).toBe('You');
  });

  // ---------------------------------------------------------------- onReplyPosted

  it('onReplyPosted: refreshes conversations and sets selectedId to the new status id', () => {
    const fixture = setUp([]);
    const status = makeStatus('new-status');
    fixture.componentInstance.onReplyPosted(status);

    // A refresh request should be issued.
    httpMock.expectOne((r) => r.url === '/api/v1/conversations').flush([]);

    expect(internals(fixture).selectedId()).toBe('new-status');
  });
});
