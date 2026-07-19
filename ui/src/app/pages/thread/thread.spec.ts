import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientPrefs } from '../../client-prefs';
import { Context, Status } from '../../models';
import { Thread } from './thread';
import { anonymousStatusRouteRef } from '../../providers/anonymous/anonymous-route-ref';

interface ThreadInternals {
  status: WritableSignal<Status | null>;
  ancestors: WritableSignal<Status[]>;
  descendants: WritableSignal<Status[]>;
  loading: WritableSignal<boolean>;
}

function internals(fixture: ComponentFixture<Thread>): ThreadInternals {
  return fixture.componentInstance as unknown as ThreadInternals;
}

function makeStatus(id: string): Status {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: '1', username: 'user', acct: 'user', display_name: 'User' } as never,
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

function makeBskyStatus(id = 'bsky:at://did:plc:x/app.bsky.feed.post/1'): Status {
  return {
    ...makeStatus(id),
    provider: 'bluesky',
    providerRef: {
      uri: 'at://did:plc:x/app.bsky.feed.post/1',
      cid: 'cid-1',
      indexedAt: '2026-01-01T00:00:00Z',
      replyRoot: { uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'cid-1' },
    },
  };
}

function makeContext(ancestors: Status[] = [], descendants: Status[] = []): Context {
  return { ancestors, descendants };
}

let httpMock: HttpTestingController;

function setUpWithId(
  statusId: string,
  queryParams: Record<string, string> = {},
): ComponentFixture<Thread> {
  TestBed.overrideProvider(ActivatedRoute, {
    useValue: {
      paramMap: of(convertToParamMap({ id: statusId })),
      queryParamMap: of(convertToParamMap(queryParams)),
    },
  });
  httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Thread);
  fixture.detectChanges();
  return fixture;
}

describe('Thread', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ---------------------------------------------------------------- initial load

  it('fetches the status and its context on init', () => {
    const fixture = setUpWithId('100');

    httpMock.expectOne('/api/v1/statuses/100').flush(makeStatus('100'));
    httpMock
      .expectOne('/api/v1/statuses/100/context')
      .flush(makeContext([makeStatus('parent')], [makeStatus('child1'), makeStatus('child2')]));

    expect(internals(fixture).status()?.id).toBe('100');
    expect(
      internals(fixture)
        .ancestors()
        .map((s) => s.id),
    ).toEqual(['parent']);
    expect(
      internals(fixture)
        .descendants()
        .map((s) => s.id),
    ).toEqual(['child1', 'child2']);
    expect(internals(fixture).loading()).toBe(false);
  });

  it('loads an anonymous public thread from the source instance', () => {
    const id = anonymousStatusRouteRef({
      server: 'https://social.example',
      id: '100',
      originalUrl: 'https://social.example/@user/100',
    });
    const fixture = setUpWithId(id);

    const raw = makeStatus('100');
    raw.url = 'https://social.example/@user/100';
    raw.account.acct = 'user';
    httpMock.expectOne('https://social.example/api/v1/statuses/100').flush(raw);
    httpMock
      .expectOne('https://social.example/api/v1/statuses/100/context')
      .flush(makeContext([makeStatus('99')], [makeStatus('101')]));
    fixture.detectChanges();

    expect(internals(fixture).status()?.id).toBe('anonymous-mastodon:social.example:100');
    expect(internals(fixture).ancestors()[0].id).toBe('anonymous-mastodon:social.example:99');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-compose')).toBeNull();
    httpMock.expectNone((request) => request.url.startsWith('/api/'));
  });

  it('keeps an anonymous public post readable when its context endpoint rejects anonymous access', () => {
    const id = anonymousStatusRouteRef({ server: 'https://social.example', id: '100' });
    const fixture = setUpWithId(id);
    const raw = makeStatus('100');
    raw.account.acct = 'user';

    httpMock.expectOne('https://social.example/api/v1/statuses/100').flush(raw);
    httpMock
      .expectOne('https://social.example/api/v1/statuses/100/context')
      .flush('nope', { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    expect(internals(fixture).status()).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'did not make the surrounding conversation available anonymously',
    );
  });

  it('starts in loading state', () => {
    const fixture = setUpWithId('50');
    expect(internals(fixture).loading()).toBe(true);

    httpMock.expectOne('/api/v1/statuses/50').flush(makeStatus('50'));
    httpMock.expectOne('/api/v1/statuses/50/context').flush(makeContext());
  });

  // ---------------------------------------------------------------- onReply

  it('onReply: appends a new reply to descendants', () => {
    const fixture = setUpWithId('10');
    httpMock.expectOne('/api/v1/statuses/10').flush(makeStatus('10'));
    httpMock.expectOne('/api/v1/statuses/10/context').flush(makeContext([], [makeStatus('d1')]));

    fixture.componentInstance.onReply(makeStatus('new-reply'));

    expect(
      internals(fixture)
        .descendants()
        .map((s) => s.id),
    ).toEqual(['d1', 'new-reply']);
  });

  // ---------------------------------------------------------------- onChanged

  it('onChanged: updates the focused status', () => {
    const fixture = setUpWithId('10');
    httpMock.expectOne('/api/v1/statuses/10').flush(makeStatus('10'));
    httpMock.expectOne('/api/v1/statuses/10/context').flush(makeContext());

    const updated = { ...makeStatus('10'), favourited: true };
    fixture.componentInstance.onChanged(updated);

    expect(internals(fixture).status()?.favourited).toBe(true);
  });

  // ---------------------------------------------------------------- onContextChanged

  it('onContextChanged: patches a matching status in both ancestors and descendants', () => {
    const fixture = setUpWithId('5');
    httpMock.expectOne('/api/v1/statuses/5').flush(makeStatus('5'));
    httpMock
      .expectOne('/api/v1/statuses/5/context')
      .flush(makeContext([makeStatus('a1'), makeStatus('a2')], [makeStatus('d1')]));

    const updatedA2 = { ...makeStatus('a2'), bookmarked: true };
    fixture.componentInstance.onContextChanged(updatedA2);

    expect(internals(fixture).ancestors()[1].bookmarked).toBe(true);
    expect(internals(fixture).ancestors()[0].bookmarked).toBe(false); // untouched
  });

  // ---------------------------------------------------------------- onContextDeleted

  it('onContextDeleted: removes the status from both ancestors and descendants', () => {
    const fixture = setUpWithId('5');
    httpMock.expectOne('/api/v1/statuses/5').flush(makeStatus('5'));
    httpMock
      .expectOne('/api/v1/statuses/5/context')
      .flush(makeContext([makeStatus('a1')], [makeStatus('d1'), makeStatus('d2')]));

    fixture.componentInstance.onContextDeleted(makeStatus('d1'));

    expect(
      internals(fixture)
        .ancestors()
        .map((s) => s.id),
    ).toEqual(['a1']);
    expect(
      internals(fixture)
        .descendants()
        .map((s) => s.id),
    ).toEqual(['d2']);
  });

  // ---------------------------------------------------------------- onFocusedDeleted

  it('onFocusedDeleted: navigates to /home', () => {
    const fixture = setUpWithId('99');
    httpMock.expectOne('/api/v1/statuses/99').flush(makeStatus('99'));
    httpMock.expectOne('/api/v1/statuses/99/context').flush(makeContext());

    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigateByUrl');

    fixture.componentInstance.onFocusedDeleted();

    expect(spy).toHaveBeenCalledWith('/home');
  });

  // ---------------------------------------------------------------- reader mode

  interface ReaderInternals {
    readerMode: WritableSignal<boolean>;
    chain: () => Status[];
  }

  function readerInternals(fixture: ComponentFixture<Thread>): ReaderInternals {
    return fixture.componentInstance as unknown as ReaderInternals;
  }

  function selfReply(id: string, inReplyToId: string): Status {
    return { ...makeStatus(id), in_reply_to_id: inReplyToId };
  }

  it('the Reader toggle is always offered on a loaded thread', () => {
    const fixture = setUpWithId('1');
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush(makeContext());
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.reader-bar')).not.toBeNull();
    expect(readerInternals(fixture).readerMode()).toBe(false);
  });

  it('reader mode renders the author chain as an article', () => {
    const fixture = setUpWithId('1');
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock
      .expectOne('/api/v1/statuses/1/context')
      .flush(makeContext([], [selfReply('2', '1'), selfReply('3', '2')]));
    fixture.detectChanges();

    const r = readerInternals(fixture);
    expect(r.chain().map((s) => s.id)).toEqual(['1', '2', '3']);

    fixture.componentInstance.toggleReader();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('article.reader')).not.toBeNull();
    expect(el.querySelectorAll('.reader-post')).toHaveLength(3);
    expect(el.querySelector('app-status-card')).toBeNull();
  });

  it('?reader=1 opens the thread directly in reader mode', () => {
    const fixture = setUpWithId('1', { reader: '1' });
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush(makeContext([], [selfReply('2', '1')]));
    fixture.detectChanges();

    expect(readerInternals(fixture).readerMode()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('article.reader')).not.toBeNull();
  });

  it('A+/A− buttons adjust the persisted reader font size', () => {
    const fixture = setUpWithId('1');
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush(makeContext([], [selfReply('2', '1')]));

    const prefs = TestBed.inject(ClientPrefs);
    const before = prefs.readerFontSize();
    fixture.componentInstance.bumpReaderFont(2);
    expect(prefs.readerFontSize()).toBe(before + 2);
  });

  it('uses the Bluesky reply composer beneath a Bluesky thread', () => {
    const fixture = setUpWithId('1');
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush(makeContext());

    internals(fixture).status.set(makeBskyStatus());
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-bsky-reply')).not.toBeNull();
    expect(el.querySelector('app-compose')).toBeNull();
  });

  it('uses the Bluesky reply composer in reader mode too', () => {
    const fixture = setUpWithId('1');
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush(makeContext());

    const post = makeBskyStatus();
    internals(fixture).status.set(post);
    fixture.componentInstance.toggleReader();
    fixture.componentInstance.toggleReaderReply(post.id);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.reader-reply app-bsky-reply')).not.toBeNull();
    expect(el.querySelector('.reader-reply app-compose')).toBeNull();
  });

  // ---------------------------------------------------------------------- RSS

  const RSS_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:wfw="http://wellformedweb.org/CommentAPI/">
  <channel>
    <title>Test Blog</title>
    <link>https://blog.example.com</link>
    <item>
      <title>Hello world</title>
      <link>https://blog.example.com/hello</link>
      <guid>g1</guid>
      <description>&lt;p&gt;The article body&lt;/p&gt;</description>
      <wfw:commentRss>https://blog.example.com/hello/comments</wfw:commentRss>
    </item>
  </channel>
</rss>`;

  const COMMENT_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Comments on Hello world</title>
    <item>
      <title>Comment by Dana</title>
      <guid>c1</guid>
      <dc:creator>Dana</dc:creator>
      <description>&lt;p&gt;Great post!&lt;/p&gt;</description>
    </item>
  </channel>
</rss>`;

  it('opens an RSS item in reader mode by default and loads its comment feed as replies', () => {
    const fixture = setUpWithId('rss:https://blog.example.com/feed.xml::g1');

    httpMock.expectOne('https://blog.example.com/feed.xml').flush(RSS_FEED);
    httpMock.expectOne('https://blog.example.com/hello/comments').flush(COMMENT_FEED);
    fixture.detectChanges();

    const parentId = 'rss:https://blog.example.com/feed.xml::g1';
    expect(internals(fixture).status()?.id).toBe(parentId);
    // RSS defaults straight into reader mode.
    expect(fixture.componentInstance['readerMode']()).toBe(true);
    // The comment became a descendant reply attributed to its author.
    const descendants = internals(fixture).descendants();
    expect(descendants).toHaveLength(1);
    expect(descendants[0].in_reply_to_id).toBe(parentId);
    expect(descendants[0].account.display_name).toBe('Dana');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.reader-comments')).not.toBeNull();
    // Read-only: no reply composer or action buttons in the RSS reader.
    expect(el.querySelector('.reader-actions')).toBeNull();
    expect(el.querySelector('.reader-original')).not.toBeNull();
  });

  it('shows the no-comment-feed note for RSS items without one', () => {
    const feedNoComments = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>B</title>
  <item><title>Post</title><link>https://b.example/p</link><guid>g9</guid>
  <description>&lt;p&gt;Body&lt;/p&gt;</description></item>
</channel></rss>`;
    const fixture = setUpWithId('rss:https://b.example/feed::g9');

    httpMock.expectOne('https://b.example/feed').flush(feedNoComments);
    fixture.detectChanges();

    expect(internals(fixture).descendants()).toHaveLength(0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.reader-comments-note')?.textContent).toContain(
      "doesn't publish comments",
    );
  });
});
