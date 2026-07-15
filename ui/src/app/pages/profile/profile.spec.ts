import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { Account, Relationship, Status } from '../../models';
import { Profile } from './profile';

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
    httpMock.expectOne('/api/v1/accounts/900').flush({ id: '900', username: 'eve' } as Account);
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

    return fixture;
  }

  afterEach(() => httpMock.verify());

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

    httpMock.expectOne('/api/v1/accounts/7').flush({ id: '7', username: 'kay' } as Account);
    httpMock.expectOne((r) => r.params.get('pinned') === 'true').flush([]);
    httpMock.expectOne((r) => r.url === '/api/v1/accounts/relationships').flush([]);
    httpMock.expectOne('/api/v1/accounts/7/endorsements').flush([]);

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
