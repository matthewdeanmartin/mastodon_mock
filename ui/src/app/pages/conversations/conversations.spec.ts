import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../../auth';
import { ClientPrefs } from '../../client-prefs';
import { Streaming, StreamEvent, StreamKind } from '../../streaming';
import { Account, Conversation, MastodonNotification, Relationship, Status } from '../../models';
import { Chat, Conversations, stripLeadingMentions } from './conversations';

interface ConversationsInternals {
  loading: WritableSignal<boolean>;
  privateConvs: WritableSignal<Conversation[]>;
  selectedKey: WritableSignal<string | null>;
  messages: WritableSignal<Status[]>;
  chats: Signal<Chat[]>;
  visibleChats: Signal<Chat[]>;
  selected: Signal<Chat | null>;
  replyMentions: Signal<string>;
  replyToId: Signal<string | undefined>;
  replyVisibility: Signal<string>;
}

function internals(fixture: ComponentFixture<Conversations>): ConversationsInternals {
  return fixture.componentInstance as unknown as ConversationsInternals;
}

/** The component opens two streams (direct + user); track subscribers per kind. */
class MultiFakeStreaming {
  private subscribers = new Map<string, (ev: StreamEvent) => void>();
  openedKinds: string[] = [];

  open(kind: StreamKind) {
    this.openedKinds.push(kind.stream);
    return {
      subscribe: (fn: (ev: StreamEvent) => void): Subscription => {
        this.subscribers.set(kind.stream, fn);
        return new Subscription(() => this.subscribers.delete(kind.stream));
      },
    } as unknown as ReturnType<Streaming['open']>;
  }

  emit(stream: string, ev: StreamEvent): void {
    this.subscribers.get(stream)?.(ev);
  }
}

function makeAccount(id: string, acct = `user${id}`, display_name = `User ${id}`): Account {
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
  } as unknown as Account;
}

const ME = makeAccount('me', 'me_user', 'Me');

function makeStatus(id: string, overrides: Partial<Status> = {}): Status {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'direct',
    url: null,
    account: makeAccount('1'),
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
    ...overrides,
  };
}

function makeConversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return { id, unread: false, accounts: [], last_status: null, ...overrides };
}

function makeMention(
  id: string,
  status: Status,
  account: Account = status.account,
): MastodonNotification {
  return { id, type: 'mention', created_at: status.created_at, account, status };
}

describe('Conversations', () => {
  let httpMock: HttpTestingController;
  let streaming: MultiFakeStreaming;

  beforeEach(() => {
    localStorage.clear();
    streaming = new MultiFakeStreaming();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Streaming, useValue: streaming },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).account.set(ME);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(
    conversations: Conversation[] = [],
    notifications: MastodonNotification[] = [],
  ): ComponentFixture<Conversations> {
    const fixture = TestBed.createComponent(Conversations);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === '/api/v1/conversations').flush(conversations);
    httpMock.expectOne((r) => r.url === '/api/v1/notifications').flush(notifications);
    return fixture;
  }

  // ---------------------------------------------------------------- initial load

  it('fetches conversations and notifications on init and clears loading', () => {
    const fixture = TestBed.createComponent(Conversations);
    fixture.detectChanges();

    expect(internals(fixture).loading()).toBe(true);

    httpMock.expectOne((r) => r.url === '/api/v1/conversations').flush([makeConversation('1')]);
    httpMock.expectOne((r) => r.url === '/api/v1/notifications').flush([]);

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).chats()).toHaveLength(1);
    expect(internals(fixture).chats()[0].kind).toBe('private');
  });

  it('clears loading even when both requests fail', () => {
    const fixture = TestBed.createComponent(Conversations);
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url === '/api/v1/conversations')
      .flush('', { status: 500, statusText: 'Error' });
    httpMock
      .expectOne((r) => r.url === '/api/v1/notifications')
      .flush('', { status: 500, statusText: 'Error' });

    expect(internals(fixture).loading()).toBe(false);
  });

  it('opens the direct and user streams on init and closes them on destroy', () => {
    const fixture = setUp();
    expect(streaming.openedKinds.sort()).toEqual(['direct', 'user']);
    fixture.destroy();
  });

  // ---------------------------------------------------------------- public chat grouping

  it('groups mention notifications by author into one public chat', () => {
    const alice = makeAccount('2', 'alice');
    const s1 = makeStatus('s1', { visibility: 'public', account: alice });
    const s2 = makeStatus('s2', {
      visibility: 'public',
      account: alice,
      created_at: '2026-01-02T00:00:00Z',
    });
    const fixture = setUp([], [makeMention('n1', s1), makeMention('n2', s2)]);

    const chats = internals(fixture).chats();
    expect(chats).toHaveLength(1);
    expect(chats[0].kind).toBe('public');
    expect(chats[0].lastStatus?.id).toBe('s2');
  });

  it('different authors produce different public chats', () => {
    const s1 = makeStatus('s1', { visibility: 'public', account: makeAccount('2', 'alice') });
    const s2 = makeStatus('s2', { visibility: 'public', account: makeAccount('3', 'bob') });
    const fixture = setUp([], [makeMention('n1', s1), makeMention('n2', s2)]);

    expect(internals(fixture).chats()).toHaveLength(2);
  });

  it('same author groups together even when replies mention different third parties', () => {
    const alice = makeAccount('2', 'alice');
    const s1 = makeStatus('s1', {
      visibility: 'public',
      account: alice,
      mentions: [{ id: 'me', username: 'me_user', acct: 'me_user', url: '' }],
    });
    const s2 = makeStatus('s2', {
      visibility: 'public',
      account: alice,
      created_at: '2026-01-02T00:00:00Z',
      mentions: [
        { id: 'me', username: 'me_user', acct: 'me_user', url: '' },
        { id: '3', username: 'bob', acct: 'bob', url: '' },
      ],
    });
    const fixture = setUp([], [makeMention('n1', s1), makeMention('n2', s2)]);

    const chats = internals(fixture).chats();
    expect(chats).toHaveLength(1);
    expect(chats[0].handles).toEqual(['alice']);
  });

  it('ignores direct-visibility mentions (those belong to the conversations API)', () => {
    const s1 = makeStatus('s1', { visibility: 'direct', account: makeAccount('2', 'alice') });
    const fixture = setUp([], [makeMention('n1', s1)]);

    expect(internals(fixture).chats()).toHaveLength(0);
  });

  // ---------------------------------------------------------------- select / threads

  it('select on an unread private chat POSTs mark-read and fetches the thread context', () => {
    const status = makeStatus('s1');
    const conv = makeConversation('c1', { unread: true, last_status: status });
    const fixture = setUp([conv]);

    fixture.componentInstance.select(internals(fixture).chats()[0]);

    const read = httpMock.expectOne('/api/v1/conversations/c1/read');
    expect(read.request.method).toBe('POST');
    read.flush({ ...conv, unread: false });
    expect(internals(fixture).privateConvs()[0].unread).toBe(false);

    const ancestor = makeStatus('s0');
    httpMock
      .expectOne('/api/v1/statuses/s1/context')
      .flush({ ancestors: [ancestor], descendants: [] });

    expect(
      internals(fixture)
        .messages()
        .map((m) => m.id),
    ).toEqual(['s0', 's1']);
  });

  it('select on a public chat marks it read locally (no server call)', () => {
    const s1 = makeStatus('s1', { visibility: 'public', account: makeAccount('2', 'alice') });
    const fixture = setUp([], [makeMention('n1', s1)]);

    const chat = internals(fixture).chats()[0];
    expect(chat.unread).toBe(true);

    fixture.componentInstance.select(chat);
    httpMock.expectOne('/api/v1/statuses/s1/context').flush({ ancestors: [], descendants: [] });

    expect(internals(fixture).chats()[0].unread).toBe(false);
    httpMock.expectNone((r) => r.url.includes('/read'));
  });

  // ---------------------------------------------------------------- composer seeds

  it('replyMentions and replyVisibility: direct for private chats', () => {
    const conv = makeConversation('c1', {
      accounts: [makeAccount('2', 'alice'), makeAccount('3', 'bob')],
      last_status: makeStatus('s1'),
    });
    const fixture = setUp([conv]);
    internals(fixture).selectedKey.set('priv:alice,bob');

    expect(internals(fixture).replyMentions()).toBe('@alice @bob ');
    expect(internals(fixture).replyVisibility()).toBe('direct');
    expect(internals(fixture).replyToId()).toBe('s1');
  });

  it("replyVisibility: public chats reply with the thread's own visibility", () => {
    const s1 = makeStatus('s1', { visibility: 'unlisted', account: makeAccount('2', 'alice') });
    const fixture = setUp([], [makeMention('n1', s1)]);
    internals(fixture).selectedKey.set(internals(fixture).chats()[0].key);

    expect(internals(fixture).replyVisibility()).toBe('unlisted');
  });

  it("replyMentions (public): seeds the other recipients but drops the obvious author", () => {
    // The reply reaches alice implicitly via in_reply_to_id, so her handle is
    // left out of the box; bob (a co-recipient) still needs an explicit mention.
    const alice = makeAccount('2', 'alice');
    const s1 = makeStatus('s1', {
      visibility: 'public',
      account: alice,
      mentions: [
        { id: 'me', username: 'me_user', acct: 'me_user', url: '' },
        { id: '3', username: 'bob', acct: 'bob', url: '' },
      ],
    });
    const fixture = setUp([], [makeMention('n1', s1)]);
    internals(fixture).selectedKey.set(internals(fixture).chats()[0].key);

    expect(internals(fixture).replyMentions()).toBe('@bob ');
  });

  it('replyToId chains onto the newest loaded message, not the list row', () => {
    const conv = makeConversation('c1', { last_status: makeStatus('s1') });
    const fixture = setUp([conv]);
    internals(fixture).selectedKey.set('priv:');
    internals(fixture).messages.set([
      makeStatus('s1'),
      makeStatus('s2', { created_at: '2026-01-02T00:00:00Z' }),
    ]);

    expect(internals(fixture).replyToId()).toBe('s2');
  });

  // ---------------------------------------------------------------- title()

  it('title: a public chat is named after its author (the reply guy)', () => {
    const alice = makeAccount('2', 'alice', 'Alice A');
    const s1 = makeStatus('s1', {
      visibility: 'public',
      account: alice,
      mentions: [{ id: '3', username: 'bob', acct: 'bob', url: '' }],
    });
    const fixture = setUp([], [makeMention('n1', s1)]);

    const chat = internals(fixture).chats()[0];
    expect(fixture.componentInstance.title(chat)).toBe('Alice A');
  });

  it('title: returns "Me" for a self-conversation with no participants', () => {
    const conv = makeConversation('c1');
    const fixture = setUp([conv]);
    expect(fixture.componentInstance.title(internals(fixture).chats()[0])).toBe('Me');
  });

  // ---------------------------------------------------------------- streaming

  it('a conversation stream event upserts the private chat list', () => {
    const fixture = setUp([]);
    const conv = makeConversation('c9', { unread: true, last_status: makeStatus('s9') });

    streaming.emit('direct', { event: 'conversation', payload: conv });

    const chats = internals(fixture).chats();
    expect(chats).toHaveLength(1);
    expect(chats[0].key).toBe('priv:');
  });

  it('a mention notification on the user stream adds a public chat row', () => {
    const fixture = setUp();
    const alice = makeAccount('2', 'alice');
    const s1 = makeStatus('s1', { visibility: 'public', account: alice });

    streaming.emit('user', { event: 'notification', payload: makeMention('n1', s1, alice) });

    const chats = internals(fixture).chats();
    expect(chats).toHaveLength(1);
    expect(chats[0].kind).toBe('public');
    expect(chats[0].accounts[0].acct).toBe('alice');
  });

  it('a streamed reply to the open thread is appended', () => {
    const s1 = makeStatus('s1', { visibility: 'public', account: makeAccount('2', 'alice') });
    const fixture = setUp([], [makeMention('n1', s1)]);
    fixture.componentInstance.select(internals(fixture).chats()[0]);
    httpMock.expectOne('/api/v1/statuses/s1/context').flush({ ancestors: [], descendants: [] });

    const reply = makeStatus('s2', {
      visibility: 'public',
      in_reply_to_id: 's1',
      created_at: '2026-01-02T00:00:00Z',
      account: makeAccount('2', 'alice'),
    });
    streaming.emit('user', { event: 'update', payload: reply });

    expect(
      internals(fixture)
        .messages()
        .map((m) => m.id),
    ).toEqual(['s1', 's2']);
  });

  it('a delete on the user stream removes the message from the open thread', () => {
    const fixture = setUp();
    internals(fixture).messages.set([makeStatus('s1'), makeStatus('s2')]);

    streaming.emit('user', { event: 'delete', payload: 's1' });

    expect(
      internals(fixture)
        .messages()
        .map((m) => m.id),
    ).toEqual(['s2']);
  });

  // ---------------------------------------------------------------- onReplyPosted

  it('onReplyPosted (private): appends the message and refreshes conversations', () => {
    const conv = makeConversation('c1', { last_status: makeStatus('s1') });
    const fixture = setUp([conv]);
    internals(fixture).selectedKey.set('priv:');

    const posted = makeStatus('s2', { created_at: '2026-01-02T00:00:00Z', account: ME });
    fixture.componentInstance.onReplyPosted(posted);

    expect(
      internals(fixture)
        .messages()
        .some((m) => m.id === 's2'),
    ).toBe(true);
    httpMock
      .expectOne((r) => r.url === '/api/v1/conversations')
      .flush([makeConversation('c1', { last_status: posted })]);
  });

  it('onReplyPosted (public): appends without refetching conversations', () => {
    const s1 = makeStatus('s1', { visibility: 'public', account: makeAccount('2', 'alice') });
    const fixture = setUp([], [makeMention('n1', s1)]);
    internals(fixture).selectedKey.set(internals(fixture).chats()[0].key);

    const posted = makeStatus('s2', {
      visibility: 'public',
      created_at: '2026-01-02T00:00:00Z',
      account: ME,
      mentions: [{ id: '2', username: 'alice', acct: 'alice', url: '' }],
    });
    fixture.componentInstance.onReplyPosted(posted);

    expect(
      internals(fixture)
        .messages()
        .some((m) => m.id === 's2'),
    ).toBe(true);
    httpMock.expectNone((r) => r.url === '/api/v1/conversations');
    // The posted status also advances the public chat row.
    expect(internals(fixture).chats()[0].lastStatus?.id).toBe('s2');
  });

  // ---------------------------------------------------------------- list filters

  it('the kind toggle filters the visible list without touching the underlying chats', () => {
    const conv = makeConversation('c1', { last_status: makeStatus('s0') });
    const s1 = makeStatus('s1', { visibility: 'public', account: makeAccount('2', 'alice') });
    const fixture = setUp([conv], [makeMention('n1', s1)]);
    const prefs = TestBed.inject(ClientPrefs);

    expect(internals(fixture).visibleChats()).toHaveLength(2);

    prefs.setChatKind('private');
    expect(
      internals(fixture)
        .visibleChats()
        .map((c) => c.kind),
    ).toEqual(['private']);

    prefs.setChatKind('public');
    expect(
      internals(fixture)
        .visibleChats()
        .map((c) => c.kind),
    ).toEqual(['public']);

    expect(internals(fixture).chats()).toHaveLength(2);
  });

  it('the mutuals toggle fetches relationships lazily and hides non-mutual chats', () => {
    const alice = makeAccount('2', 'alice');
    const bob = makeAccount('3', 'bob');
    const s1 = makeStatus('s1', { visibility: 'public', account: alice });
    const s2 = makeStatus('s2', { visibility: 'public', account: bob });
    const fixture = setUp([], [makeMention('n1', s1), makeMention('n2', s2)]);
    const prefs = TestBed.inject(ClientPrefs);

    // No relationships requested while the filter is off.
    httpMock.expectNone((r) => r.url === '/api/v1/accounts/relationships');

    prefs.setChatAudience('mutuals');
    fixture.detectChanges();

    const rel = (id: string, mutual: boolean): Relationship => ({
      id,
      following: mutual,
      followed_by: mutual,
      requested: false,
      blocking: false,
      muting: false,
    });
    httpMock
      .expectOne((r) => r.url === '/api/v1/accounts/relationships')
      .flush([rel('2', true), rel('3', false)]);

    const visible = internals(fixture).visibleChats();
    expect(visible).toHaveLength(1);
    expect(visible[0].accounts[0].acct).toBe('alice');

    prefs.setChatAudience('everyone');
    expect(internals(fixture).visibleChats()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- mention elision

describe('stripLeadingMentions', () => {
  it('drops a plain-text leading mention', () => {
    expect(stripLeadingMentions('<p>@mistersql hello there</p>')).toBe('<p>hello there</p>');
  });

  it('drops several leading mentions including domain forms', () => {
    expect(stripLeadingMentions('<p>@alice @bob@example.com sounds good</p>')).toBe(
      '<p>sounds good</p>',
    );
  });

  it("drops Mastodon's h-card mention markup", () => {
    const html =
      '<p><span class="h-card"><a href="https://x/@alice" class="u-url mention">@alice</a></span> the actual text</p>';
    expect(stripLeadingMentions(html)).toBe('<p>the actual text</p>');
  });

  it('keeps mentions that appear mid-sentence', () => {
    expect(stripLeadingMentions('<p>ask @alice about it</p>')).toBe('<p>ask @alice about it</p>');
  });

  it('falls back to the original when the message is only mentions', () => {
    expect(stripLeadingMentions('<p>@alice @bob</p>')).toBe('<p>@alice @bob</p>');
  });
});
