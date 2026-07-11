import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../auth';
import { Status, Translation } from '../models';
import { StatusCard } from './status-card';

/** Expose protected signals/methods for white-box testing. */
interface StatusCardInternals {
  replying: WritableSignal<boolean>;
  quoting: WritableSignal<boolean>;
  showReport: WritableSignal<boolean>;
  reported: WritableSignal<boolean>;
  editing: WritableSignal<boolean>;
  editText: WritableSignal<string>;
  saving: WritableSignal<boolean>;
  translation: WritableSignal<Translation | null>;
  translating: WritableSignal<boolean>;
  pollSelection: WritableSignal<number[]>;
  showPolicyMenu: WritableSignal<boolean>;
  showHistory: WritableSignal<boolean>;
}

function internals(fixture: ComponentFixture<StatusCard>): StatusCardInternals {
  return fixture.componentInstance as unknown as StatusCardInternals;
}

// ---------------------------------------------------------------- shared test data

function makeAccount(id = '1') {
  return {
    id,
    username: `user${id}`,
    acct: `user${id}`,
    display_name: `User ${id}`,
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

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    id: '1',
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: '<p>Hello</p>',
    spoiler_text: '',
    visibility: 'public',
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

function fakeEvent(): Event {
  return { stopPropagation: vi.fn() } as unknown as Event;
}

describe('StatusCard', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** Creates a fixture, sets the required `status` input, and runs the first CD cycle. */
  function setUp(status = makeStatus()): ComponentFixture<StatusCard> {
    const fixture = TestBed.createComponent(StatusCard);
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    return fixture;
  }

  // ---------------------------------------------------------------- display / boostedBy

  it('display returns the status itself when it is not a reblog', () => {
    const s = makeStatus({ id: '42' });
    const f = setUp(s);
    expect(f.componentInstance.display.id).toBe('42');
  });

  it('display unwraps the reblog when the status is a boost', () => {
    const original = makeStatus({ id: 'orig' });
    const boost = makeStatus({ id: 'boost', reblog: original });
    const f = setUp(boost);
    expect(f.componentInstance.display.id).toBe('orig');
  });

  it('boostedBy returns null for a plain status', () => {
    const f = setUp(makeStatus());
    expect(f.componentInstance.boostedBy).toBeNull();
  });

  it('boostedBy returns the booster display_name for a reblog', () => {
    const booster = makeAccount('2');
    booster.display_name = 'Booster McBoostface';
    const boost = makeStatus({ account: booster, reblog: makeStatus({ id: 'orig' }) });
    const f = setUp(boost);
    expect(f.componentInstance.boostedBy).toBe('Booster McBoostface');
  });

  // ---------------------------------------------------------------- openReport / onReported

  it('openReport: sets showReport and calls stopPropagation', () => {
    const f = setUp();
    const ev = fakeEvent();
    f.componentInstance.openReport(ev);
    expect(internals(f).showReport()).toBe(true);
    expect((ev.stopPropagation as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('onReported: hides the report dialog and marks the status as reported', () => {
    const f = setUp();
    f.componentInstance.openReport(fakeEvent());
    f.componentInstance.onReported();
    expect(internals(f).showReport()).toBe(false);
    expect(internals(f).reported()).toBe(true);
  });

  // ---------------------------------------------------------------- startEdit / cancelEdit

  it('startEdit: fetches status source and opens the edit field', () => {
    const f = setUp();
    f.componentInstance.startEdit(fakeEvent());

    const req = httpMock.expectOne('/api/v1/statuses/1/source');
    req.flush({ id: '1', text: 'original text', spoiler_text: '' });

    expect(internals(f).editing()).toBe(true);
    expect(internals(f).editText()).toBe('original text');
  });

  it('cancelEdit: closes the edit field', () => {
    const f = setUp();
    f.componentInstance.startEdit(fakeEvent());
    httpMock.expectOne('/api/v1/statuses/1/source').flush({ id: '1', text: 'x', spoiler_text: '' });

    f.componentInstance.cancelEdit();
    expect(internals(f).editing()).toBe(false);
  });

  // ---------------------------------------------------------------- saveEdit

  it('saveEdit: PUTs updated text and emits changed with the server response', () => {
    const changed: Status[] = [];
    const f = setUp();
    f.componentInstance.changed.subscribe((s) => changed.push(s));

    // Open edit mode.
    f.componentInstance.startEdit(fakeEvent());
    httpMock.expectOne('/api/v1/statuses/1/source').flush({ id: '1', text: 'old', spoiler_text: '' });

    internals(f).editText.set('new content');
    f.componentInstance.saveEdit();

    const req = httpMock.expectOne('/api/v1/statuses/1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.status).toBe('new content');
    const updated = makeStatus({ id: '1', content: '<p>new content</p>' });
    req.flush(updated);

    expect(changed).toHaveLength(1);
    expect(changed[0].content).toBe('<p>new content</p>');
    expect(internals(f).editing()).toBe(false);
  });

  it('saveEdit: does nothing when text is blank', () => {
    const f = setUp();
    f.componentInstance.startEdit(fakeEvent());
    httpMock.expectOne('/api/v1/statuses/1/source').flush({ id: '1', text: '', spoiler_text: '' });

    internals(f).editText.set('   ');
    f.componentInstance.saveEdit();

    httpMock.expectNone('/api/v1/statuses/1');
  });

  it('saveEdit: clears saving flag on HTTP error', () => {
    const f = setUp();
    f.componentInstance.startEdit(fakeEvent());
    httpMock.expectOne('/api/v1/statuses/1/source').flush({ id: '1', text: 'x', spoiler_text: '' });

    internals(f).editText.set('edited');
    f.componentInstance.saveEdit();

    httpMock.expectOne('/api/v1/statuses/1').flush('', { status: 422, statusText: 'Unprocessable' });

    expect(internals(f).saving()).toBe(false);
  });

  // ---------------------------------------------------------------- toggleReply / toggleQuote

  it('toggleReply: flips replying and collapses any open quote composer', () => {
    const f = setUp();
    internals(f).quoting.set(true);

    f.componentInstance.toggleReply(fakeEvent());

    expect(internals(f).replying()).toBe(true);
    expect(internals(f).quoting()).toBe(false);
  });

  it('toggleReply: a second call collapses the reply composer', () => {
    const f = setUp();
    f.componentInstance.toggleReply(fakeEvent());
    f.componentInstance.toggleReply(fakeEvent());
    expect(internals(f).replying()).toBe(false);
  });

  it('toggleQuote: flips quoting and collapses any open reply composer', () => {
    const f = setUp();
    internals(f).replying.set(true);

    f.componentInstance.toggleQuote(fakeEvent());

    expect(internals(f).quoting()).toBe(true);
    expect(internals(f).replying()).toBe(false);
  });

  // ---------------------------------------------------------------- onReplied / onQuoted

  it('onReplied: closes the reply composer and emits changed with incremented replies_count', () => {
    const changed: Status[] = [];
    const replied: Status[] = [];
    const f = setUp(makeStatus({ replies_count: 3 }));
    f.componentInstance.changed.subscribe((s) => changed.push(s));
    f.componentInstance.replied.subscribe((s) => replied.push(s));

    internals(f).replying.set(true);
    const replyStatus = makeStatus({ id: '99' });
    f.componentInstance.onReplied(replyStatus);

    expect(internals(f).replying()).toBe(false);
    expect(changed[0].replies_count).toBe(4);
    expect(replied[0].id).toBe('99');
  });

  it('onQuoted: closes the quote composer and emits replied with the new quote post', () => {
    const replied: Status[] = [];
    const f = setUp();
    f.componentInstance.replied.subscribe((s) => replied.push(s));

    internals(f).quoting.set(true);
    const quotePost = makeStatus({ id: 'qp-1' });
    f.componentInstance.onQuoted(quotePost);

    expect(internals(f).quoting()).toBe(false);
    expect(replied[0].id).toBe('qp-1');
  });

  // ---------------------------------------------------------------- toggleFavourite

  it('toggleFavourite: POSTs to /favourite when not yet favourited and emits changed', () => {
    const changed: Status[] = [];
    const f = setUp(makeStatus({ id: '5', favourited: false }));
    f.componentInstance.changed.subscribe((s) => changed.push(s));

    f.componentInstance.toggleFavourite(fakeEvent());

    const req = httpMock.expectOne('/api/v1/statuses/5/favourite');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '5', favourited: true }));

    expect(changed[0].favourited).toBe(true);
  });

  it('toggleFavourite: POSTs to /unfavourite when already favourited', () => {
    const f = setUp(makeStatus({ id: '5', favourited: true }));
    f.componentInstance.toggleFavourite(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/5/unfavourite');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '5', favourited: false }));
  });

  // ---------------------------------------------------------------- toggleReblog

  it('toggleReblog: POSTs to /reblog when not yet reblogged', () => {
    const f = setUp(makeStatus({ id: '7', reblogged: false }));
    f.componentInstance.toggleReblog(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/7/reblog');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '7' })); // reblog wrapper
  });

  it('toggleReblog: POSTs to /unreblog when already reblogged', () => {
    const f = setUp(makeStatus({ id: '7', reblogged: true }));
    f.componentInstance.toggleReblog(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/7/unreblog');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '7' }));
  });

  // ---------------------------------------------------------------- toggleBookmark

  it('toggleBookmark: POSTs to /bookmark when not yet bookmarked', () => {
    const f = setUp(makeStatus({ id: '8', bookmarked: false }));
    f.componentInstance.toggleBookmark(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/8/bookmark');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '8' }));
  });

  it('toggleBookmark: POSTs to /unbookmark when already bookmarked', () => {
    const f = setUp(makeStatus({ id: '8', bookmarked: true }));
    f.componentInstance.toggleBookmark(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/8/unbookmark');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '8' }));
  });

  // ---------------------------------------------------------------- togglePin

  it('togglePin: POSTs to /pin when not pinned', () => {
    const f = setUp(makeStatus({ id: '9', pinned: false }));
    f.componentInstance.togglePin(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/9/pin');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '9' }));
  });

  it('togglePin: POSTs to /unpin when already pinned', () => {
    const f = setUp(makeStatus({ id: '9', pinned: true }));
    f.componentInstance.togglePin(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/9/unpin');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '9' }));
  });

  // ---------------------------------------------------------------- toggleMute

  it('toggleMute: POSTs to /mute when not muted', () => {
    const f = setUp(makeStatus({ id: '10', muted: false }));
    f.componentInstance.toggleMute(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/10/mute');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '10' }));
  });

  it('toggleMute: POSTs to /unmute when already muted', () => {
    const f = setUp(makeStatus({ id: '10', muted: true }));
    f.componentInstance.toggleMute(fakeEvent());
    const req = httpMock.expectOne('/api/v1/statuses/10/unmute');
    expect(req.request.method).toBe('POST');
    req.flush(makeStatus({ id: '10' }));
  });

  // ---------------------------------------------------------------- toggleTranslate

  it('toggleTranslate: calls /translate and stores result', () => {
    const f = setUp(makeStatus({ id: '11' }));
    f.componentInstance.toggleTranslate(fakeEvent());

    const req = httpMock.expectOne('/api/v1/statuses/11/translate');
    const translation: Translation = {
      content: '<p>Hello</p>',
      spoiler_text: '',
      detected_source_language: 'de',
      provider: 'DeepL',
    };
    req.flush(translation);

    expect(internals(f).translation()).toEqual(translation);
    expect(internals(f).translating()).toBe(false);
  });

  it('toggleTranslate: a second call clears the translation (show original)', () => {
    const f = setUp(makeStatus({ id: '11' }));
    // Pre-seed a translation.
    internals(f).translation.set({
      content: '<p>Hola</p>',
      spoiler_text: '',
      detected_source_language: 'es',
      provider: 'Google',
    });
    f.componentInstance.toggleTranslate(fakeEvent());

    // No HTTP request; just clears.
    httpMock.expectNone('/api/v1/statuses/11/translate');
    expect(internals(f).translation()).toBeNull();
  });

  it('toggleTranslate: clears translating flag on HTTP error', () => {
    const f = setUp(makeStatus({ id: '11' }));
    f.componentInstance.toggleTranslate(fakeEvent());
    httpMock.expectOne('/api/v1/statuses/11/translate').flush('', { status: 503, statusText: 'Unavailable' });
    expect(internals(f).translating()).toBe(false);
  });

  // ---------------------------------------------------------------- pollPercent

  it('pollPercent: returns the correct percentage for a poll option', () => {
    const f = setUp(
      makeStatus({
        id: '12',
        poll: {
          id: 'p1',
          expires_at: null,
          expired: false,
          multiple: false,
          votes_count: 100,
          voters_count: 80,
          options: [
            { title: 'Yes', votes_count: 75 },
            { title: 'No', votes_count: 25 },
          ],
          voted: false,
          own_votes: [],
        },
      }),
    );
    expect(f.componentInstance.pollPercent({ votes_count: 75 })).toBe(75);
    expect(f.componentInstance.pollPercent({ votes_count: 25 })).toBe(25);
  });

  it('pollPercent: returns 0 when total votes are 0', () => {
    const f = setUp();
    // No poll — votes_count defaults to 0.
    expect(f.componentInstance.pollPercent({ votes_count: 0 })).toBe(0);
  });

  // ---------------------------------------------------------------- toggleChoice

  it('toggleChoice: sets the selection for single-choice polls', () => {
    const f = setUp(
      makeStatus({
        poll: {
          id: 'p1',
          expires_at: null,
          expired: false,
          multiple: false,
          votes_count: 0,
          voters_count: 0,
          options: [{ title: 'A', votes_count: 0 }, { title: 'B', votes_count: 0 }],
          voted: false,
          own_votes: [],
        },
      }),
    );
    f.componentInstance.toggleChoice(1);
    expect(internals(f).pollSelection()).toEqual([1]);

    // Picking a different option replaces the previous one.
    f.componentInstance.toggleChoice(0);
    expect(internals(f).pollSelection()).toEqual([0]);
  });

  it('toggleChoice: toggles multi-choice selections', () => {
    const f = setUp(
      makeStatus({
        poll: {
          id: 'p1',
          expires_at: null,
          expired: false,
          multiple: true,
          votes_count: 0,
          voters_count: 0,
          options: [
            { title: 'A', votes_count: 0 },
            { title: 'B', votes_count: 0 },
            { title: 'C', votes_count: 0 },
          ],
          voted: false,
          own_votes: [],
        },
      }),
    );
    f.componentInstance.toggleChoice(0);
    f.componentInstance.toggleChoice(2);
    expect(internals(f).pollSelection()).toEqual([0, 2]);

    // De-selecting an already-selected option removes it.
    f.componentInstance.toggleChoice(0);
    expect(internals(f).pollSelection()).toEqual([2]);
  });

  // ---------------------------------------------------------------- openHistory / togglePolicyMenu

  it('openHistory: sets showHistory to true and calls stopPropagation', () => {
    const f = setUp();
    const ev = fakeEvent();
    f.componentInstance.openHistory(ev);
    expect(internals(f).showHistory()).toBe(true);
    expect((ev.stopPropagation as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('togglePolicyMenu: flips the showPolicyMenu signal', () => {
    const f = setUp();
    expect(internals(f).showPolicyMenu()).toBe(false);
    f.componentInstance.togglePolicyMenu(fakeEvent());
    expect(internals(f).showPolicyMenu()).toBe(true);
    f.componentInstance.togglePolicyMenu(fakeEvent());
    expect(internals(f).showPolicyMenu()).toBe(false);
  });

  // ---------------------------------------------------------------- setPolicy

  it('setPolicy: POSTs the policy and emits changed, then closes the policy menu', () => {
    const changed: Status[] = [];
    const f = setUp(makeStatus({ id: '15' }));
    f.componentInstance.changed.subscribe((s) => changed.push(s));

    internals(f).showPolicyMenu.set(true);
    f.componentInstance.setPolicy('followers');

    const req = httpMock.expectOne('/api/v1/statuses/15/interaction_policy');
    expect(req.request.method).toBe('PUT');
    req.flush(makeStatus({ id: '15' }));

    expect(changed).toHaveLength(1);
    expect(internals(f).showPolicyMenu()).toBe(false);
  });

  // ---------------------------------------------------------------- isOwn

  it('isOwn is true when the logged-in user owns the status', () => {
    // Inject Auth before creating any component to avoid "TestBed already instantiated" errors.
    const auth = TestBed.inject(Auth);
    auth.setAccount(makeAccount('42') as never);
    const f = setUp(makeStatus({ account: makeAccount('42') }));
    const comp = f.componentInstance as unknown as { isOwn: Signal<boolean> };
    expect(comp.isOwn()).toBe(true);
  });

  it('isOwn is false when the status belongs to another account', () => {
    const auth = TestBed.inject(Auth);
    auth.setAccount(makeAccount('1') as never);
    const f = setUp(makeStatus({ account: makeAccount('2') }));
    const comp = f.componentInstance as unknown as { isOwn: Signal<boolean> };
    expect(comp.isOwn()).toBe(false);
  });
});
