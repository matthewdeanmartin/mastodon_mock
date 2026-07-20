import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account, Relationship, Status } from '../../models';
import { Profile } from './profile';
import { Auth } from '../../auth';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';
import { anonymousAccountRouteRef } from '../../providers/anonymous/anonymous-route-ref';

/** n bare statuses with descending ids starting at s<base> (timeline order). */
function makeStatuses(n: number, base: number): Status[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `s${base + i}`,
        content: `post ${base + i}`,
        account: { id: '7', username: 'kay' },
        media_attachments: [],
      }) as unknown as Status,
  );
}

/**
 * Profile block/unblock wiring, isolated at the HTTP boundary — no live or mock server.
 * We drive the component's toggleBlock() and assert it hits the right endpoint based on the
 * current relationship, then reflects the server's updated relationship.
 */
describe('Profile block/unblock', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => localStorage.clear());

  function setUp() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: '900' })) },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();

    // load() fans out five requests; satisfy them so the component settles.
    httpMock
      .expectOne('/api/v1/accounts/900')
      .flush({ id: '900', username: 'eve', fields: [] } as unknown as Account);
    httpMock
      .expectOne((r) => r.url === '/api/v1/accounts/900/statuses' && !r.params.has('pinned'))
      .flush([]);
    httpMock
      .expectOne(
        (r) => r.url === '/api/v1/accounts/900/statuses' && r.params.get('pinned') === 'true',
      )
      .flush([]);
    httpMock
      .expectOne((r) => r.url === '/api/v1/accounts/relationships')
      .flush([{ id: '900', blocking: false } as Relationship]);
    httpMock.expectOne('/api/v1/accounts/900/endorsements').flush([]);
    httpMock.expectOne('/api/v1/accounts/900/collections').flush({ collections: [] });

    return fixture;
  }

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('blocks an un-blocked account via POST /block and stores the updated relationship', () => {
    const fixture = setUp();
    const cmp = fixture.componentInstance as any;
    expect(cmp.relationship().blocking).toBe(false);

    cmp.toggleBlock();

    const req = httpMock.expectOne('/api/v1/accounts/900/block');
    expect(req.request.method).toBe('POST');
    req.flush({ id: '900', blocking: true } as Relationship);

    expect(cmp.relationship().blocking).toBe(true);
  });

  it('follows locally in Anonymous without relationship mutation requests', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: '900' })) },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    const target = {
      id: '900',
      username: 'eve',
      acct: 'eve@example.social',
      display_name: 'Eve',
      note: '',
      url: 'https://example.social/@eve',
      avatar: '',
      avatar_static: '',
      header: '',
      followers_count: 0,
      following_count: 0,
      statuses_count: 0,
      bot: false,
      locked: false,
      fields: [],
    } as Account;

    httpMock.expectOne('/api/v1/accounts/900').flush(target);
    httpMock
      .expectOne(
        (request) =>
          request.url === '/api/v1/accounts/900/statuses' && !request.params.has('pinned'),
      )
      .flush([]);
    httpMock
      .expectOne(
        (request) =>
          request.url === '/api/v1/accounts/900/statuses' &&
          request.params.get('pinned') === 'true',
      )
      .flush([]);
    httpMock.expectOne('/api/v1/accounts/900/endorsements').flush([]);
    httpMock.expectOne('/api/v1/accounts/900/collections').flush({ collections: [] });
    httpMock.expectNone((request) => request.url.includes('/relationships'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Local lists');

    (fixture.componentInstance as any).toggleFollow();

    expect(TestBed.inject(AnonymousFollows).count()).toBe(1);
    expect((fixture.componentInstance as any).relationship().following).toBe(true);
    httpMock.expectNone((request) => /\/(follow|unfollow)$/.test(request.url));
  });

  it('loads a public profile and posts from the referenced instance in Anonymous', () => {
    const routeId = anonymousAccountRouteRef({ server: 'https://social.example', id: '900' });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: routeId })) },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).enterAnonymous('https://home.example');
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    const target = {
      id: '900',
      username: 'eve',
      acct: 'eve',
      display_name: 'Eve',
      note: '',
      url: 'https://social.example/@eve',
      avatar: '',
      avatar_static: '',
      header: '',
      followers_count: 0,
      following_count: 0,
      statuses_count: 1,
      bot: false,
      locked: false,
      fields: [],
    } as Account;
    const post = {
      id: '50',
      created_at: '2026-01-01T00:00:00Z',
      edited_at: null,
      content: '<p>Public</p>',
      spoiler_text: '',
      visibility: 'public',
      url: 'https://social.example/@eve/50',
      account: target,
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
    } as Status;

    httpMock.expectOne('https://social.example/api/v1/accounts/900').flush(target);
    httpMock
      .expectOne(
        (request) =>
          request.url === 'https://social.example/api/v1/accounts/900/statuses' &&
          !request.params.has('pinned'),
      )
      .flush([post]);
    httpMock
      .expectOne(
        (request) =>
          request.url === 'https://social.example/api/v1/accounts/900/statuses' &&
          request.params.get('max_id') === '50',
      )
      .flush([]);
    httpMock
      .expectOne(
        (request) =>
          request.url === 'https://social.example/api/v1/accounts/900/statuses' &&
          request.params.get('pinned') === 'true',
      )
      .flush([]);
    httpMock
      .expectOne('https://social.example/api/v1/accounts/900/collections')
      .flush({
        collections: [
          {
            id: 'collection-1',
            account_id: '900',
            name: 'Video makers',
            description: 'People making great videos.',
            discoverable: true,
            sensitive: false,
            local: true,
            item_count: 25,
            items: [],
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            uri: 'https://social.example/ap/collections/collection-1',
            url: 'https://social.example/collections/collection-1',
          },
        ],
      });
    fixture.detectChanges();

    expect((fixture.componentInstance as any).account().acct).toBe('eve@social.example');
    expect((fixture.componentInstance as any).statuses()[0].id).toBe(
      'anonymous-mastodon:social.example:50',
    );
    const filters = fixture.nativeElement.querySelectorAll('.profile-filters button');
    expect(filters).toHaveLength(3);
    expect(
      Array.from(filters).map((button) => (button as HTMLButtonElement).textContent?.trim()),
    ).toEqual(['🔁 Boosts', '💬 Replies', '📌 Pinned']);
    const collectionCount = fixture.nativeElement.querySelector(
      '.collection-count-btn',
    ) as HTMLButtonElement;
    expect(collectionCount.textContent).toContain('Collections (1)');
    expect(collectionCount.querySelector('strong')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.collection-row')).toBeNull();

    (fixture.componentInstance as any).setTab('collections');
    fixture.detectChanges();
    const collection = fixture.nativeElement.querySelector('.collection-row') as HTMLAnchorElement;
    expect(collection.textContent).toContain('Video makers');
    expect(collection.getAttribute('href')).toBe(
      'https://social.example/collections/collection-1',
    );
    httpMock.expectNone((request) => request.url.startsWith('/api/'));
  });

  it('does not show the Collections profile count when the account has none', () => {
    const fixture = setUp();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.collection-count-btn')).toBeNull();
    expect(fixture.nativeElement.querySelector('.profile-collections')).toBeNull();
  });

  it('places the Anonymous login-to-post prompt in the self profile timeline', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'anonymous' })),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();

    const loginPost = fixture.nativeElement.querySelector(
      '.profile-login-post',
    ) as HTMLAnchorElement;
    expect(loginPost.textContent).toContain(
      'Login or create an account to post content, reply and more',
    );
    expect(loginPost.getAttribute('href')).toBe('/login');
  });

  it('keeps paging older statuses until 20 accumulate (filtered pages come back short)', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: '7' })) } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;

    httpMock
      .expectOne('/api/v1/accounts/7')
      .flush({ id: '7', username: 'kay', fields: [] } as unknown as Account);
    httpMock.expectOne((r) => r.params.get('pinned') === 'true').flush([]);
    httpMock.expectOne((r) => r.url === '/api/v1/accounts/relationships').flush([]);
    httpMock.expectOne('/api/v1/accounts/7/endorsements').flush([]);
    httpMock.expectOne('/api/v1/accounts/7/collections').flush({ collections: [] });

    // Page 1: defaults exclude replies but keep boosts; 5 of 20 requested survive.
    const first = httpMock.expectOne(
      (r) => r.url === '/api/v1/accounts/7/statuses' && !r.params.has('pinned'),
    );
    expect(first.request.params.get('exclude_replies')).toBe('true');
    expect(first.request.params.get('exclude_reblogs')).toBeNull();
    expect(first.request.params.get('limit')).toBe('20');
    first.flush(makeStatuses(5, 100));

    // Page 2 must resume from the oldest id of page 1.
    const second = httpMock.expectOne(
      (r) => r.url === '/api/v1/accounts/7/statuses' && !r.params.has('pinned'),
    );
    expect(second.request.params.get('max_id')).toBe('s104');
    second.flush(makeStatuses(15, 200));

    // 5 + 15 = 20: no third page.
    httpMock.expectNone((r) => r.url === '/api/v1/accounts/7/statuses');
    expect(cmp.statuses()).toHaveLength(20);
    expect(cmp.statusesLoading()).toBe(false);
  });

  it('stops paging when the account runs out of statuses', () => {
    const fixture = setUp();
    const cmp = fixture.componentInstance as any;

    cmp.toggleReplies(); // Refetch, now including replies.
    const first = httpMock.expectOne(
      (r) => r.url === '/api/v1/accounts/900/statuses' && !r.params.has('pinned'),
    );
    expect(first.request.params.get('exclude_replies')).toBeNull();
    first.flush(makeStatuses(3, 100));

    const second = httpMock.expectOne(
      (r) => r.url === '/api/v1/accounts/900/statuses' && !r.params.has('pinned'),
    );
    second.flush([]); // Exhausted.

    httpMock.expectNone((r) => r.url === '/api/v1/accounts/900/statuses');
    expect(cmp.statuses()).toHaveLength(3);
    expect(cmp.statusesLoading()).toBe(false);
  });

  it('toggling boosts off refetches with exclude_reblogs', () => {
    const fixture = setUp();
    const cmp = fixture.componentInstance as any;

    cmp.toggleBoosts();
    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/accounts/900/statuses' && !r.params.has('pinned'),
    );
    expect(req.request.params.get('exclude_reblogs')).toBe('true');
    req.flush([]);
  });

  it('renders custom profile fields, marking verified ones', () => {
    const fixture = setUp();
    const cmp = fixture.componentInstance as any;
    cmp.account.set({
      id: '900',
      username: 'eve',
      acct: 'eve',
      display_name: 'Eve',
      fields: [
        { name: 'Blog', value: '<a href="https://eve.blog">eve.blog</a>', verified_at: null },
        { name: 'Site', value: '<a href="https://eve.dev">eve.dev</a>', verified_at: '2026-01-01' },
      ],
    } as Account);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.profile-field');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Blog');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('https://eve.blog');
    expect(rows[0].classList.contains('verified')).toBe(false);
    expect(rows[1].classList.contains('verified')).toBe(true);
    expect(rows[1].querySelector('.field-check')).not.toBeNull();
  });

  it('hides pinned duplicates from the main list while the pinned strip is on', () => {
    const fixture = setUp();
    const cmp = fixture.componentInstance as any;

    const [a, b, c] = makeStatuses(3, 100);
    cmp.statuses.set([a, b, c]);
    cmp.pinnedStatuses.set([b]);

    expect(cmp.visibleStatuses().map((s: Status) => s.id)).toEqual([a.id, c.id]);
    cmp.togglePinned(); // Strip off: the post shows in its natural position again.
    expect(cmp.visibleStatuses()).toHaveLength(3);
  });

  it('unblocks a blocked account via POST /unblock', () => {
    const fixture = setUp();
    const cmp = fixture.componentInstance as any;
    // Pretend the account is already blocked.
    cmp.relationship.set({ id: '900', blocking: true } as Relationship);

    cmp.toggleBlock();

    const req = httpMock.expectOne('/api/v1/accounts/900/unblock');
    expect(req.request.method).toBe('POST');
    req.flush({ id: '900', blocking: false } as Relationship);

    expect(cmp.relationship().blocking).toBe(false);
  });
});
