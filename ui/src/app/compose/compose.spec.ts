import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientPrefs } from '../client-prefs';
import { Drafts } from '../drafts';
import { Status } from '../models';
import { Auth } from '../auth';
import { BlueskySession } from '../providers/bluesky/bluesky-session';
import { CorsProxySettings } from '../providers/cors-proxy/cors-proxy-settings';
import { ShortenerSettings } from '../providers/shortener/shortener-settings';
import { Compose, PostTarget, describePostFailure } from './compose';
import { MataroaSettings } from '../providers/mataroa/mataroa-settings';
import { BloggerSession } from '../providers/blogger/blogger-session';
import { HugoSettings } from '../providers/hugo/hugo-settings';
import { HugoEdit, HugoEditSession } from '../providers/hugo/hugo-edit-session';
import { HugoDeployWatch } from '../providers/hugo/hugo-deploy-watch';

/** Edit codes are stored apart from the records — see storage-registry.ts. */
function storedEditKeys(): Record<string, string> {
  return JSON.parse(localStorage.getItem('mockingbird_paste_edit_keys') ?? '{}');
}

/** Expose the protected internals for white-box testing. */
interface ComposeInternals {
  text: WritableSignal<string>;
  submitting: WritableSignal<boolean>;
  uploading: WritableSignal<boolean>;
  visibility: WritableSignal<string>;
  cwOpen: WritableSignal<boolean>;
  spoilerText: WritableSignal<string>;
  sensitive: WritableSignal<boolean>;
  media: WritableSignal<{ media: { id: string }; description: string }[]>;
  pollOpen: WritableSignal<boolean>;
  pollOptions: WritableSignal<string[]>;
  pollMultiple: WritableSignal<boolean>;
  pollExpiresIn: WritableSignal<number>;
  canSubmit: Signal<boolean>;
  canAttachMedia: Signal<boolean>;
  canAddPoll: Signal<boolean>;
  countdown: Signal<number | null>;
  thread: WritableSignal<string[]>;
  segments: Signal<string[]>;
  overLimit: Signal<boolean>;
  addThreadBox(): void;
  setThreadText(index: number, value: string): void;
  removeThreadBox(index: number): void;
  cancelSend(): void;
  publishNow(): void;
  target: WritableSignal<PostTarget>;
  pasteLanguage: WritableSignal<string>;
  pasteExpiry: WritableSignal<string>;
  pasteProviderId: WritableSignal<string>;
  onPasteProviderChange(providerId: string): void;
  onPasteExpiryChange(expiry: string): void;
  onTargetChange(target: PostTarget): void;
  onVisibilityChange(visibility: string): void;
  cancelHugoEdit(): void;
  pendingSelfCleanup: WritableSignal<string | null>;
  selfCleanupError: WritableSignal<string | null>;
  deleteSelfDraftCopy(): void;
  showTargetPicker: Signal<boolean>;
  crossPostError: Signal<string | null>;
  toggleCw(): void;
  togglePoll(): void;
  addPollOption(): void;
  removePollOption(index: number): void;
  setPollOption(index: number, value: string): void;
  setMediaDescription(index: number, description: string): void;
  removeMedia(index: number): void;
  submit(): void;
  blogDraft: WritableSignal<boolean>;
  postLanguage: WritableSignal<string>;
  langMismatch: WritableSignal<{ picked: string; detected: string } | null>;
  onLanguageChange(code: string): void;
  dismissLangMismatch(): void;
  showReplyMentionHint: Signal<boolean>;
  shortenError: WritableSignal<string | null>;
  shortenerConsentPrompt: WritableSignal<{
    carriesCredential: boolean;
    proxy: { label: string };
  } | null>;
  shortenLinks(): Promise<void>;
  acceptShortenerConsent(): Promise<void>;
  declineShortenerConsent(): void;
}

function internals(fixture: ComponentFixture<Compose>): ComposeInternals {
  return fixture.componentInstance as unknown as ComposeInternals;
}

describe('Compose', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    // The Blogger token lives in sessionStorage; without this a test that links
    // it leaks a connected state into every test that follows.
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function setUp(): ComponentFixture<Compose> {
    const fixture = TestBed.createComponent(Compose);
    fixture.detectChanges();
    return fixture;
  }

  // ---------------------------------------------------------------- canSubmit

  it('canSubmit is false when text is empty', () => {
    const f = setUp();
    expect(internals(f).canSubmit()).toBe(false);
  });

  it('canSubmit is true when text has non-whitespace content', () => {
    const f = setUp();
    internals(f).text.set('Hello world');
    expect(internals(f).canSubmit()).toBe(true);
  });

  it('canSubmit is false when text is only whitespace', () => {
    const f = setUp();
    internals(f).text.set('   ');
    expect(internals(f).canSubmit()).toBe(false);
  });

  it('canSubmit is false while submitting', () => {
    const f = setUp();
    internals(f).text.set('Hello');
    internals(f).submitting.set(true);
    expect(internals(f).canSubmit()).toBe(false);
  });

  it('canSubmit is false while uploading media', () => {
    const f = setUp();
    internals(f).text.set('Hello');
    internals(f).uploading.set(true);
    expect(internals(f).canSubmit()).toBe(false);
  });

  // ---------------------------------------------------------- link shortening

  it('asks before a keyless proxy sees the URL, then retries after consent', async () => {
    TestBed.inject(ShortenerSettings).activate('isgd');
    TestBed.inject(CorsProxySettings).select('allorigins');
    const f = setUp();
    const original = 'See https://example.com/a-very-long-destination-that-needs-shortening';
    internals(f).text.set(original);

    const firstAttempt = internals(f).shortenLinks();
    httpMock
      .expectOne((request) => request.url.startsWith('https://is.gd/create.php'))
      .error(new ProgressEvent('error'), { status: 0 });
    await firstAttempt;

    expect(internals(f).shortenerConsentPrompt()?.carriesCredential).toBe(false);
    expect(internals(f).text()).toBe(original);
    httpMock.expectNone((request) => request.url.startsWith('https://api.allorigins.win/raw'));

    const retry = internals(f).acceptShortenerConsent();
    httpMock
      .expectOne((request) => request.url.startsWith('https://is.gd/create.php'))
      .error(new ProgressEvent('error'), { status: 0 });
    httpMock
      .expectOne((request) => request.url.startsWith('https://api.allorigins.win/raw'))
      .flush({ shorturl: 'https://is.gd/abc123' });
    await retry;

    expect(internals(f).text()).toBe('See https://is.gd/abc123');
    expect(internals(f).shortenerConsentPrompt()).toBeNull();
  });

  it('keeps the post unchanged and suggests alternatives when proxy consent is declined', async () => {
    TestBed.inject(ShortenerSettings).activate('isgd');
    TestBed.inject(CorsProxySettings).select('allorigins');
    const f = setUp();
    const original = 'See https://example.com/a-very-long-destination-that-needs-shortening';
    internals(f).text.set(original);

    const attempt = internals(f).shortenLinks();
    httpMock
      .expectOne((request) => request.url.startsWith('https://is.gd/create.php'))
      .error(new ProgressEvent('error'), { status: 0 });
    await attempt;
    internals(f).declineShortenerConsent();

    expect(internals(f).text()).toBe(original);
    expect(internals(f).shortenError()).toContain('different CORS proxy');
  });

  it('canSubmit is true with an open poll that has at least 2 non-empty options', () => {
    const f = setUp();
    internals(f).pollOpen.set(true);
    internals(f).pollOptions.set(['Option A', 'Option B']);
    expect(internals(f).canSubmit()).toBe(true);
  });

  it('canSubmit is false with a poll where fewer than 2 options are filled', () => {
    const f = setUp();
    internals(f).pollOpen.set(true);
    internals(f).pollOptions.set(['Only one', '']);
    expect(internals(f).canSubmit()).toBe(false);
  });

  // ---------------------------------------------------------------- canAttachMedia / canAddPoll

  it('canAttachMedia is true when no poll is open', () => {
    const f = setUp();
    internals(f).pollOpen.set(false);
    expect(internals(f).canAttachMedia()).toBe(true);
  });

  it('canAttachMedia is false when poll is open', () => {
    const f = setUp();
    internals(f).pollOpen.set(true);
    expect(internals(f).canAttachMedia()).toBe(false);
  });

  it('canAddPoll is true when no media is attached', () => {
    const f = setUp();
    expect(internals(f).canAddPoll()).toBe(true);
  });

  it('canAddPoll is false when media is attached', () => {
    const f = setUp();
    internals(f).media.set([{ media: { id: '1' }, description: '' }]);
    expect(internals(f).canAddPoll()).toBe(false);
  });

  // ---------------------------------------------------------------- toggleCw

  it('toggleCw opens the CW field', () => {
    const f = setUp();
    expect(internals(f).cwOpen()).toBe(false);
    internals(f).toggleCw();
    expect(internals(f).cwOpen()).toBe(true);
  });

  it('toggleCw closes the CW field and clears the spoiler text', () => {
    const f = setUp();
    internals(f).toggleCw();
    internals(f).spoilerText.set('spoiler!');
    internals(f).toggleCw();
    expect(internals(f).cwOpen()).toBe(false);
    expect(internals(f).spoilerText()).toBe('');
  });

  // ---------------------------------------------------------------- togglePoll

  it('togglePoll opens the poll section', () => {
    const f = setUp();
    internals(f).togglePoll();
    expect(internals(f).pollOpen()).toBe(true);
  });

  it('togglePoll closes the poll and resets options', () => {
    const f = setUp();
    internals(f).togglePoll();
    internals(f).pollOptions.set(['A', 'B', 'C']);
    internals(f).pollMultiple.set(true);
    internals(f).togglePoll();
    expect(internals(f).pollOpen()).toBe(false);
    expect(internals(f).pollOptions()).toEqual(['', '']);
    expect(internals(f).pollMultiple()).toBe(false);
  });

  // ---------------------------------------------------------------- poll option management

  it('addPollOption appends an empty option', () => {
    const f = setUp();
    internals(f).addPollOption();
    expect(internals(f).pollOptions()).toEqual(['', '', '']);
  });

  it('addPollOption does nothing when 4 options exist', () => {
    const f = setUp();
    internals(f).pollOptions.set(['A', 'B', 'C', 'D']);
    internals(f).addPollOption();
    expect(internals(f).pollOptions()).toHaveLength(4);
  });

  it('removePollOption removes the option at the given index', () => {
    const f = setUp();
    internals(f).pollOptions.set(['A', 'B', 'C']);
    internals(f).removePollOption(1);
    expect(internals(f).pollOptions()).toEqual(['A', 'C']);
  });

  it('removePollOption does nothing when only 2 options remain', () => {
    const f = setUp();
    // Default starts with ['', ''].
    internals(f).removePollOption(0);
    expect(internals(f).pollOptions()).toEqual(['', '']);
  });

  it('setPollOption updates the value at the correct index', () => {
    const f = setUp();
    internals(f).setPollOption(0, 'Yes');
    internals(f).setPollOption(1, 'No');
    expect(internals(f).pollOptions()).toEqual(['Yes', 'No']);
  });

  // ---------------------------------------------------------------- media management

  it('setMediaDescription updates the description for the correct item', () => {
    const f = setUp();
    internals(f).media.set([
      { media: { id: '1' }, description: '' },
      { media: { id: '2' }, description: '' },
    ]);
    internals(f).setMediaDescription(0, 'A cat');
    expect(internals(f).media()[0].description).toBe('A cat');
    expect(internals(f).media()[1].description).toBe('');
  });

  it('removeMedia removes the attachment at the given index', () => {
    const f = setUp();
    internals(f).media.set([
      { media: { id: '1' }, description: '' },
      { media: { id: '2' }, description: '' },
    ]);
    internals(f).removeMedia(0);
    expect(
      internals(f)
        .media()
        .map((m) => m.media.id),
    ).toEqual(['2']);
  });

  // ---------------------------------------------------------------- submit()

  it('submit() does nothing when canSubmit is false', () => {
    const f = setUp();
    // text is empty, so canSubmit is false
    internals(f).submit();
    httpMock.expectNone('/api/v1/statuses');
  });

  it('submit() POSTs the trimmed text and emits the posted status', () => {
    const f = setUp();
    const posted: Status[] = [];
    f.componentInstance.posted.subscribe((s) => posted.push(s));

    internals(f).text.set('  Hello world  ');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.status).toBe('Hello world');

    const stub = { id: '100', content: '<p>Hello world</p>' } as Status;
    req.flush(stub);

    expect(posted).toHaveLength(1);
    expect(posted[0].id).toBe('100');
  });

  it('submit() resets the composer after a successful post', () => {
    const f = setUp();
    internals(f).text.set('Test post');
    internals(f).cwOpen.set(true);
    internals(f).spoilerText.set('cw');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    req.flush({ id: '1' });

    expect(internals(f).text()).toBe('');
    expect(internals(f).cwOpen()).toBe(false);
    expect(internals(f).spoilerText()).toBe('');
    expect(internals(f).submitting()).toBe(false);
  });

  it('submit() clears the submitting flag on HTTP error', () => {
    const f = setUp();
    internals(f).text.set('Test post');
    internals(f).submit();

    httpMock.expectOne('/api/v1/statuses').flush('', { status: 500, statusText: 'Error' });

    expect(internals(f).submitting()).toBe(false);
  });

  it('submit() includes spoiler_text when the CW is open and non-empty', () => {
    const f = setUp();
    internals(f).text.set('Post text');
    internals(f).cwOpen.set(true);
    internals(f).spoilerText.set('Content warning');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.spoiler_text).toBe('Content warning');
    req.flush({ id: '1' });
  });

  it('submit() omits spoiler_text when CW is open but text is whitespace-only', () => {
    const f = setUp();
    internals(f).text.set('Post text');
    internals(f).cwOpen.set(true);
    internals(f).spoilerText.set('   ');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.spoiler_text).toBeUndefined();
    req.flush({ id: '1' });
  });

  it('submit() includes media_ids when media is attached', () => {
    const f = setUp();
    internals(f).text.set('Photo post');
    internals(f).media.set([
      { media: { id: 'media-1' }, description: '' },
      { media: { id: 'media-2' }, description: '' },
    ]);
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.media_ids).toEqual(['media-1', 'media-2']);
    req.flush({ id: '1' });
  });

  it('submit() includes poll params when poll is open and valid', () => {
    const f = setUp();
    internals(f).pollOpen.set(true);
    internals(f).pollOptions.set(['Yes', 'No']);
    internals(f).pollExpiresIn.set(3600);
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.poll).toEqual({
      options: ['Yes', 'No'],
      expires_in: 3600,
      multiple: false,
    });
    req.flush({ id: '1' });
  });

  // ---------------------------------------------------------------- thread boxes

  it('thread boxes post as a chained self-reply thread', () => {
    const f = setUp();
    const posted: Status[] = [];
    f.componentInstance.posted.subscribe((s) => posted.push(s));

    internals(f).text.set('first post');
    internals(f).addThreadBox();
    internals(f).setThreadText(0, 'second post');
    internals(f).addThreadBox();
    internals(f).setThreadText(1, 'third post');
    internals(f).submit();

    const first = httpMock.expectOne('/api/v1/statuses');
    expect(first.request.body.status).toBe('first post');
    expect(first.request.body.in_reply_to_id).toBeUndefined();
    first.flush({ id: 'root' });

    const second = httpMock.expectOne('/api/v1/statuses');
    expect(second.request.body.status).toBe('second post');
    expect(second.request.body.in_reply_to_id).toBe('root');
    second.flush({ id: 'child' });

    const third = httpMock.expectOne('/api/v1/statuses');
    expect(third.request.body.status).toBe('third post');
    expect(third.request.body.in_reply_to_id).toBe('child');
    third.flush({ id: 'tail' });

    // The root status (not the tail) is what containers receive.
    expect(posted).toHaveLength(1);
    expect(posted[0].id).toBe('root');
    expect(internals(f).text()).toBe('');
    expect(internals(f).thread()).toEqual([]);
  });

  it('empty thread boxes are skipped when posting', () => {
    const f = setUp();
    internals(f).text.set('only real post');
    internals(f).addThreadBox();
    internals(f).submit();

    httpMock.expectOne('/api/v1/statuses').flush({ id: '1' });
    httpMock.expectNone('/api/v1/statuses');
  });

  it('over-limit text blocks posting instead of auto-splitting', () => {
    const f = setUp();
    internals(f).text.set('x'.repeat(501));

    expect(internals(f).overLimit()).toBe(true);
    expect(internals(f).canSubmit()).toBe(false);
    internals(f).submit();
    httpMock.expectNone('/api/v1/statuses');
  });

  it('short text posts as a single unmarked status', () => {
    const f = setUp();
    internals(f).text.set('just a short post');
    internals(f).submit();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.status).toBe('just a short post');
    req.flush({ id: '1' });
    httpMock.expectNone('/api/v1/statuses');
  });

  // ---------------------------------------------------------------- undo send

  function enableUndoSend(): void {
    const prefs = TestBed.inject(ClientPrefs);
    prefs.setConfirmBeforePost(true);
    prefs.setDelayedSend(true);
  }

  it('undo-send asks for confirmation and defers the POST by 30 seconds', () => {
    vi.useFakeTimers();
    enableUndoSend();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const f = setUp();
    internals(f).text.set('risky post');
    internals(f).submit();

    expect(confirmSpy).toHaveBeenCalledWith('Do you really want to post that?');
    httpMock.expectNone('/api/v1/statuses');
    expect(internals(f).countdown()).toBe(30);

    vi.advanceTimersByTime(29_000);
    httpMock.expectNone('/api/v1/statuses');
    expect(internals(f).countdown()).toBe(1);

    vi.advanceTimersByTime(1_000);
    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.status).toBe('risky post');
    req.flush({ id: '1' });
    expect(internals(f).countdown()).toBeNull();
  });

  it('declining the confirmation aborts without posting and keeps the draft', () => {
    enableUndoSend();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const f = setUp();
    internals(f).text.set('never mind');
    internals(f).submit();

    httpMock.expectNone('/api/v1/statuses');
    expect(internals(f).text()).toBe('never mind');
    expect(internals(f).countdown()).toBeNull();
  });

  it('cancelSend() stops the countdown and keeps the draft', () => {
    vi.useFakeTimers();
    enableUndoSend();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const f = setUp();
    internals(f).text.set('second thoughts');
    internals(f).submit();
    vi.advanceTimersByTime(10_000);
    internals(f).cancelSend();
    vi.advanceTimersByTime(60_000);

    httpMock.expectNone('/api/v1/statuses');
    expect(internals(f).text()).toBe('second thoughts');
    expect(internals(f).countdown()).toBeNull();
  });

  it('publishNow() during the countdown posts immediately', () => {
    vi.useFakeTimers();
    enableUndoSend();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const f = setUp();
    internals(f).text.set('impatient post');
    internals(f).submit();
    vi.advanceTimersByTime(5_000);
    internals(f).publishNow();

    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.status).toBe('impatient post');
    req.flush({ id: '1' });
    expect(internals(f).countdown()).toBeNull();

    // The dead timer must not fire a second post.
    vi.advanceTimersByTime(60_000);
    httpMock.expectNone('/api/v1/statuses');
  });

  it('confirm-only (no delay) posts immediately after an accepted confirmation', () => {
    TestBed.inject(ClientPrefs).setConfirmBeforePost(true);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const f = setUp();
    internals(f).text.set('confirmed post');
    internals(f).submit();

    expect(confirmSpy).toHaveBeenCalled();
    expect(internals(f).countdown()).toBeNull();
    httpMock.expectOne('/api/v1/statuses').flush({ id: '1' });
  });

  it('delay-only (no confirm) starts the countdown without asking', () => {
    vi.useFakeTimers();
    TestBed.inject(ClientPrefs).setDelayedSend(true);
    const confirmSpy = vi.spyOn(window, 'confirm');

    const f = setUp();
    internals(f).text.set('slow post');
    internals(f).submit();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(internals(f).countdown()).toBe(30);
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne('/api/v1/statuses').flush({ id: '1' });
  });

  it('undo-send disabled: posts immediately without confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const f = setUp();
    internals(f).text.set('normal post');
    internals(f).submit();

    expect(confirmSpy).not.toHaveBeenCalled();
    httpMock.expectOne('/api/v1/statuses').flush({ id: '1' });
  });

  // -------------------------------------------------------------- post target

  const CREATE_RECORD = 'https://bsky.social/xrpc/com.atproto.repo.createRecord';

  function linkBsky(): void {
    TestBed.inject(BlueskySession).session.set({
      service: 'https://bsky.social',
      handle: 'me.bsky.social',
      did: 'did:plc:me',
      accessJwt: 'jwt',
      refreshJwt: 'refresh',
    });
  }

  it('shows the target picker for Paste and posts to Fedi by default without Bluesky', () => {
    const f = setUp();
    expect(internals(f).showTargetPicker()).toBe(true);
    expect(internals(f).target()).toBe('fedi');
    internals(f).text.set('plain post');
    internals(f).submit();
    httpMock.expectOne('/api/v1/statuses').flush({ id: '1' });
  });

  it('defaults to Fedi even when Bluesky is linked', () => {
    linkBsky();
    const f = setUp();
    expect(internals(f).showTargetPicker()).toBe(true);
    expect(internals(f).target()).toBe('fedi');
    internals(f).text.set('fedi post');
    internals(f).submit();
    httpMock.expectOne('/api/v1/statuses').flush({ id: '1' });
    httpMock.expectNone(CREATE_RECORD);
  });

  /** A finished Blogger OAuth flow with a blog chosen, driven through real state. */
  function linkBlogger(name = 'My Blog'): void {
    const session = TestBed.inject(BloggerSession);
    session.adoptToken('tok', 3600);
    session.chooseBlog('123', name, 'https://my.blogspot.com/');
  }

  it('offers Mataroa and Blogger as separate, simultaneous blog targets', () => {
    TestBed.inject(MataroaSettings).connect('key', 'https://writer.mataroa.blog/');
    linkBlogger();

    const f = setUp();
    const values = [
      ...(f.nativeElement as HTMLElement).querySelectorAll<HTMLOptionElement>(
        '.target-select option',
      ),
    ].map((option) => option.value);

    // Two different blogs, not one "Blog" that means whichever is connected.
    expect(values).toContain('blog');
    expect(values).toContain('blogger');
  });

  it('offers the draft toggle only for Blogger, which is the only target with drafts', () => {
    TestBed.inject(MataroaSettings).connect('key', 'https://writer.mataroa.blog/');
    linkBlogger();
    const f = setUp();

    internals(f).onTargetChange('blog');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.blog-draft')).toBeNull();

    internals(f).onTargetChange('blogger');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.blog-draft')).not.toBeNull();
  });

  it('clears the draft flag when leaving a blog target, so it cannot leak into a toot', () => {
    linkBlogger();
    const f = setUp();
    internals(f).onTargetChange('blogger');
    internals(f).blogDraft.set(true);

    internals(f).onTargetChange('fedi');
    expect(internals(f).blogDraft()).toBe(false);
  });

  it('names the Mataroa blog target and requires a title', () => {
    TestBed.inject(MataroaSettings).connect('key', 'https://writer.mataroa.blog/');
    const f = setUp();
    const blogOption = [
      ...(f.nativeElement as HTMLElement).querySelectorAll<HTMLOptionElement>(
        '.target-select option',
      ),
    ].find((option) => option.value === 'blog');

    // Named per service now that Blogger is a second, simultaneous blog target
    // — a generic "Blog" would not say which one a post is going to.
    expect(blogOption?.textContent).toContain('Mataroa');
    internals(f).onTargetChange('blog');
    internals(f).text.set('## A Markdown body');
    expect(internals(f).canSubmit()).toBe(false);

    internals(f).spoilerText.set('A title');
    expect(internals(f).canSubmit()).toBe(true);
    expect(internals(f).canAttachMedia()).toBe(false);
    expect(internals(f).canAddPoll()).toBe(false);
  });

  /** A connected Hugo repo, driven through real state like the others. */
  function linkHugo(): void {
    TestBed.inject(HugoSettings).connect('github_pat_secret', {
      owner: 'mistersql',
      repo: 'my-blog',
      branch: 'main',
      contentPath: 'content/posts',
      siteUrl: 'https://mistersql.github.io/my-blog/',
      includeInProfile: false,
    });
  }

  it('offers Hugo as a third simultaneous blog target, named for its repo', () => {
    TestBed.inject(MataroaSettings).connect('key', 'https://writer.mataroa.blog/');
    linkBlogger();
    linkHugo();
    const f = setUp();

    const options = [
      ...(f.nativeElement as HTMLElement).querySelectorAll<HTMLOptionElement>(
        '.target-select option',
      ),
    ];
    expect(options.map((option) => option.value)).toEqual(
      expect.arrayContaining(['blog', 'blogger', 'hugo']),
    );
    // Named for the repo, so a user with three blogs can tell where a post goes.
    expect(options.find((option) => option.value === 'hugo')?.textContent).toContain(
      'mistersql/my-blog',
    );
  });

  it('applies every blog rule to Hugo without naming it anywhere', () => {
    linkHugo();
    const f = setUp();
    internals(f).onTargetChange('hugo');
    internals(f).text.set('## A Markdown body');

    // Title required, media and polls unavailable — all inherited from
    // isBlogTarget rather than restated per service.
    expect(internals(f).canSubmit()).toBe(false);
    internals(f).spoilerText.set('A title');
    expect(internals(f).canSubmit()).toBe(true);
    expect(internals(f).canAttachMedia()).toBe(false);
    expect(internals(f).canAddPoll()).toBe(false);
  });

  it('offers the draft toggle for Hugo, which has a native draft state', () => {
    linkHugo();
    const f = setUp();

    internals(f).onTargetChange('hugo');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.blog-draft')).not.toBeNull();
  });

  it('does not offer Hugo when only the repo is stored and the token has gone', () => {
    // The state an imported-settings browser is in: coordinates, no credential.
    // The repo half alone cannot publish, so offering the target would be a
    // button whose only outcome is an error.
    localStorage.setItem(
      'mockingbird_hugo_repo',
      JSON.stringify({ owner: 'mistersql', repo: 'my-blog' }),
    );
    const f = setUp();

    expect(TestBed.inject(HugoSettings).repo()).not.toBeNull();
    const values = [
      ...(f.nativeElement as HTMLElement).querySelectorAll<HTMLOptionElement>(
        '.target-select option',
      ),
    ].map((option) => option.value);
    expect(values).not.toContain('hugo');
  });

  /** The state the connector page leaves behind when you click "Edit". */
  function parkHugoEdit(over: Partial<HugoEdit> = {}): void {
    linkHugo();
    TestBed.inject(HugoEditSession).start({
      path: 'content/posts/hello-world.md',
      sha: 'blob-1',
      format: 'toml',
      date: '2020-03-04T05:06:07Z',
      extraLines: ['weight = 5'],
      originalTitle: 'Hello World',
      ...over,
    });
  }

  it('opens on the Hugo target when an edit is parked, not on Fedi', () => {
    parkHugoEdit();
    const f = setUp();

    // The user clicked Edit on a specific file; opening on Fedi would offer to
    // post their blog post as a toot.
    expect(internals(f).target()).toBe('hugo');
  });

  it('shows an unmistakable editing banner naming the file', () => {
    parkHugoEdit();
    const f = setUp();

    const banner = (f.nativeElement as HTMLElement).querySelector('.hugo-editing');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Hello World');
    expect(banner?.textContent).toContain('content/posts/hello-world.md');
  });

  it('labels the button Update post rather than Publish while editing', () => {
    parkHugoEdit();
    const f = setUp();
    internals(f).spoilerText.set('Hello World');
    internals(f).text.set('Revised.');
    f.detectChanges();

    const label = [
      ...(f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button.btn'),
    ]
      .map((b) => b.textContent?.trim())
      .find((t) => t === 'Update post' || t === 'Publish');
    expect(label).toBe('Update post');
  });

  it('abandons the edit when the target moves off Hugo', () => {
    parkHugoEdit();
    const f = setUp();

    internals(f).onTargetChange('fedi');

    // A parked path and sha that outlived the target would attach to whatever
    // the user writes next.
    expect(TestBed.inject(HugoEditSession).editing()).toBe(false);
  });

  it('abandons the edit when the user cancels, leaving the file alone', () => {
    parkHugoEdit();
    const f = setUp();

    internals(f).cancelHugoEdit();

    expect(TestBed.inject(HugoEditSession).editing()).toBe(false);
    expect(internals(f).text()).toBe('');
  });

  it('shows build status after publishing, and dismisses it on demand', () => {
    linkHugo();
    const f = setUp();
    const watch = TestBed.inject(HugoDeployWatch);
    watch.watch('commit-abc');
    f.detectChanges();

    const chip = (f.nativeElement as HTMLElement).querySelector('.hugo-deploy');
    expect(chip).not.toBeNull();
    // "Published" alone was the lie: the commit landed, the build has not run.
    expect(chip?.textContent).toContain('Committed');

    watch.stop();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.hugo-deploy')).toBeNull();
  });

  it('stops watching a build when the composer goes away', () => {
    linkHugo();
    const f = setUp();
    const watch = TestBed.inject(HugoDeployWatch);
    watch.watch('commit-abc');

    f.destroy();

    // A publish followed by navigating away must not leave a poller running.
    expect(watch.current()).toBeNull();
  });

  // ------------------------------------------------- paste visibility clamping
  //
  // Paste services only speak public/unlisted, so selecting Paste has to narrow
  // whatever the user picked. The bug these cover is that it used to be a
  // one-way trip: coming back to Fedi left the post silently downgraded to
  // unlisted, quietly overriding a deliberate choice.

  it('restores the pre-paste visibility when the target leaves paste', () => {
    const f = setUp();
    internals(f).onVisibilityChange('private');
    internals(f).onTargetChange('paste');
    expect(internals(f).visibility()).toBe('unlisted');

    internals(f).onTargetChange('fedi');
    expect(internals(f).visibility()).toBe('private');
  });

  it('restores what the user chose before ANY paste clamp, across providers', () => {
    const f = setUp();
    internals(f).onVisibilityChange('direct');
    internals(f).onTargetChange('paste');
    internals(f).onPasteProviderChange('rentry');
    internals(f).onPasteProviderChange('pastepile');

    internals(f).onTargetChange('fedi');
    expect(internals(f).visibility()).toBe('direct');
  });

  it('a hand-picked visibility on paste outranks the stashed one', () => {
    const f = setUp();
    internals(f).onVisibilityChange('private');
    internals(f).onTargetChange('paste');
    // The user deliberately chooses public while on Paste.
    internals(f).onVisibilityChange('public');

    internals(f).onTargetChange('fedi');
    expect(internals(f).visibility()).toBe('public');
  });

  it('falls back to the account posting default when nothing was stashed', () => {
    TestBed.inject(ClientPrefs).setDefaultVisibility('private');
    const f = setUp();
    // Straight to paste from the default public — a clamp happens, but then the
    // user picks by hand, dropping the stash.
    internals(f).onTargetChange('paste');
    internals(f).onVisibilityChange('unlisted');

    internals(f).onTargetChange('fedi');
    expect(internals(f).visibility()).toBe('private');
  });

  it('leaving burn expiry gives back the visibility burn narrowed', () => {
    const f = setUp();
    internals(f).onTargetChange('paste');
    internals(f).onPasteProviderChange('pastepile');
    internals(f).onVisibilityChange('public');

    internals(f).onPasteExpiryChange('burn');
    expect(internals(f).visibility()).toBe('unlisted');

    internals(f).onPasteExpiryChange('1w');
    expect(internals(f).visibility()).toBe('public');
  });

  it('a composer that never touches paste keeps its visibility', () => {
    const f = setUp();
    internals(f).onVisibilityChange('private');
    internals(f).onTargetChange('bsky');
    internals(f).onTargetChange('fedi');
    expect(internals(f).visibility()).toBe('private');
  });

  it('opens on the account posting default rather than assuming public', () => {
    TestBed.inject(ClientPrefs).setDefaultVisibility('unlisted');
    const f = setUp();
    expect(internals(f).visibility()).toBe('unlisted');
  });

  it('target=paste creates a Pastepile paste, stores its edit key, and emits a status', () => {
    const f = setUp();
    const posted: Status[] = [];
    f.componentInstance.posted.subscribe((status) => posted.push(status));
    internals(f).target.set('paste');
    internals(f).onPasteProviderChange('pastepile');
    internals(f).text.set('print("hello")');
    internals(f).cwOpen.set(true);
    internals(f).spoilerText.set('Example');
    internals(f).visibility.set('unlisted');
    internals(f).pasteLanguage.set('python');
    internals(f).pasteExpiry.set('10m');

    internals(f).submit();

    const req = httpMock.expectOne('https://www.pastepile.com/api/public/pastes');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      title: 'Example',
      content: 'print("hello")',
      language: 'python',
      expiry: '10m',
      visibility: 'unlisted',
    });
    req.flush({
      slug: 'abc123',
      url: 'https://pastepile.com/p/abc123',
      raw_url: 'https://pastepile.com/raw/abc123',
      edit_key: 'secret',
    });

    expect(posted[0].provider).toBe('paste');
    const stored = JSON.parse(localStorage.getItem('mockingbird_pastes') ?? '[]');
    expect(stored[0].editKey).toBeUndefined();
    expect(Object.values(storedEditKeys())).toContain('secret');
    expect(internals(f).text()).toBe('');
  });

  it('can publish an unlisted Rentry page and stores its edit code locally', () => {
    const f = setUp();
    internals(f).target.set('paste');
    internals(f).onPasteProviderChange('rentry');
    internals(f).text.set('A durable browser draft');
    internals(f).cwOpen.set(true);
    internals(f).spoilerText.set('Draft title');

    internals(f).submit();

    const request = httpMock.expectOne('https://rentry.co/api/new');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.get('text')).toBe('# Draft title\n\nA durable browser draft');
    request.flush({
      status: '200',
      url: 'https://rentry.co/browser-draft',
      edit_code: 'rentry-secret',
    });

    const stored = JSON.parse(localStorage.getItem('mockingbird_pastes') ?? '[]');
    expect(stored[0].providerId).toBe('rentry');
    expect(stored[0].editKey).toBeUndefined();
    expect(Object.values(storedEditKeys())).toContain('rentry-secret');
    expect(stored[0].expiry).toBe('never');
    expect(stored[0].visibility).toBe('unlisted');
  });

  it('keeps the user-picked paste provider when the seed effect re-runs (stale autosave)', () => {
    // Reproduces the bug where selecting Rentry still posted to the previously
    // autosaved Pastepile: the seed effect re-ran, reloaded the old autosave,
    // and clobbered the live pick. Seed a stale pastepile autosave first.
    localStorage.setItem(
      'mockingbird_compose_autosave',
      JSON.stringify({
        new: {
          segments: ['stale draft body'],
          spoilerText: '',
          sensitive: false,
          visibility: 'unlisted',
          poll: null,
          target: 'paste',
          pasteProviderId: 'pastepile',
          pasteLanguage: 'plaintext',
          pasteExpiry: '1w',
        },
      }),
    );

    const f = setUp();
    // The stale autosave seeded pastepile…
    expect(internals(f).pasteProviderId()).toBe('pastepile');

    // …the user now picks Rentry…
    internals(f).target.set('paste');
    internals(f).onPasteProviderChange('rentry');
    internals(f).text.set('A durable browser draft');

    // …and something re-triggers the seed effect (a tracked input changes).
    f.componentRef.setInput('initialText', 'nudged');
    f.detectChanges();

    // The pick must survive — not revert to the stale pastepile.
    expect(internals(f).pasteProviderId()).toBe('rentry');

    internals(f).submit();
    const request = httpMock.expectOne('https://rentry.co/api/new');
    request.flush({ status: '200', url: 'https://rentry.co/ok', edit_code: 'k' });
    expect(JSON.parse(localStorage.getItem('mockingbird_pastes') ?? '[]')[0].providerId).toBe(
      'rentry',
    );
  });

  it('replacing with a translation relabels the post language', () => {
    const f = setUp();
    internals(f).text.set('Hello everyone');
    internals(f).postLanguage.set('en');

    f.componentInstance.useTranslation({ text: 'Saluton al ĉiuj', mode: 'replace', code: 'eo' });

    expect(internals(f).text()).toBe('Saluton al ĉiuj');
    // A post rewritten into Esperanto that still declares en is exactly the
    // mislabelling the feed filter is built to catch.
    expect(internals(f).postLanguage()).toBe('eo');
  });

  it('appending keeps both versions and leaves the language alone', () => {
    const f = setUp();
    internals(f).text.set('Hello everyone');
    internals(f).postLanguage.set('en');

    f.componentInstance.useTranslation({ text: 'Saluton al ĉiuj', mode: 'append', code: 'eo' });

    expect(internals(f).text()).toBe('Hello everyone\n\nSaluton al ĉiuj');
    // A bilingual post has no single language, so guessing one would be worse
    // than leaving the user's choice.
    expect(internals(f).postLanguage()).toBe('en');
  });

  it('Anonymous defaults to Paste and cannot reach the Mastodon-backed destinations', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const f = setUp();

    expect(internals(f).target()).toBe('paste');
    const options = [...(f.nativeElement as HTMLElement).querySelectorAll('.target-select option')];
    // Fedi needs a token; with no Bluesky link there is nothing else to offer.
    expect(options.some((option) => option.getAttribute('value') === 'fedi')).toBe(false);
    expect(options.some((option) => option.getAttribute('value') === 'bsky')).toBe(false);
    expect(options.some((option) => option.getAttribute('value') === 'paste')).toBe(true);
  });

  it('Anonymous can post to a linked Bluesky, but not to Fedi or Both', () => {
    // Bluesky carries its own credential, so it works without a Mastodon
    // account — the point of the connector for Bluesky-first readers. "Both"
    // still includes a Fedi post, so it stays out.
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    linkBsky();
    const f = setUp();

    const values = [...(f.nativeElement as HTMLElement).querySelectorAll('.target-select option')]
      .map((option) => option.getAttribute('value'))
      .filter((value): value is string => value !== null);
    expect(values).toContain('bsky');
    expect(values).not.toContain('fedi');
    expect(values).not.toContain('both');
  });

  it('target=bsky posts a record to Bluesky only and emits a local status', () => {
    linkBsky();
    const f = setUp();
    const posted: Status[] = [];
    f.componentInstance.posted.subscribe((s: Status) => posted.push(s));

    internals(f).target.set('bsky');
    internals(f).text.set('hello butterfly');
    internals(f).submit();

    httpMock.expectNone('/api/v1/statuses');
    const req = httpMock.expectOne(CREATE_RECORD);
    expect(req.request.body.collection).toBe('app.bsky.feed.post');
    expect(req.request.body.record.text).toBe('hello butterfly');
    req.flush({ uri: 'at://did:plc:me/app.bsky.feed.post/xyz', cid: 'cid1' });

    expect(posted).toHaveLength(1);
    expect(posted[0].provider).toBe('bluesky');
    expect(posted[0].id).toBe('bsky:at://did:plc:me/app.bsky.feed.post/xyz');
    expect(internals(f).text()).toBe('');
  });

  it('target=both posts to Fedi and Bluesky, emitting the Fedi status', () => {
    linkBsky();
    const f = setUp();
    const posted: Status[] = [];
    f.componentInstance.posted.subscribe((s: Status) => posted.push(s));

    internals(f).target.set('both');
    internals(f).text.set('everywhere at once');
    internals(f).submit();

    const bsky = httpMock.expectOne(CREATE_RECORD);
    bsky.flush({ uri: 'at://did:plc:me/app.bsky.feed.post/abc', cid: 'cid2' });
    const fedi = httpMock.expectOne('/api/v1/statuses');
    expect(fedi.request.body.status).toBe('everywhere at once');
    fedi.flush({ id: 'm1' });

    expect(posted).toHaveLength(1);
    expect(posted[0].id).toBe('m1');
  });

  it('a failed Bluesky leg on "both" surfaces an error without retracting the Fedi post', () => {
    linkBsky();
    const f = setUp();
    const posted: Status[] = [];
    f.componentInstance.posted.subscribe((s: Status) => posted.push(s));

    internals(f).target.set('both');
    internals(f).text.set('half delivered');
    internals(f).submit();

    httpMock.expectOne(CREATE_RECORD).flush({ error: 'boom' }, { status: 500, statusText: 'ISE' });
    httpMock.expectOne('/api/v1/statuses').flush({ id: 'm2' });

    expect(posted.map((s) => s.id)).toEqual(['m2']);
    expect(internals(f).crossPostError()).toContain('Bluesky');
  });

  it('blocks submit when a Bluesky-bound post exceeds 300 graphemes', () => {
    linkBsky();
    const f = setUp();
    internals(f).target.set('both');
    internals(f).text.set('x'.repeat(301));
    expect(internals(f).canSubmit()).toBe(false);
    internals(f).target.set('fedi');
    expect(internals(f).canSubmit()).toBe(true);
  });

  it('blocks a bsky-only post that has media attached', () => {
    linkBsky();
    const f = setUp();
    internals(f).target.set('bsky');
    internals(f).text.set('with a picture');
    internals(f).media.set([{ media: { id: 'm1' }, description: '' }]);
    expect(internals(f).canSubmit()).toBe(false);
  });

  // --------------------------------------------------- language-mismatch banner

  /** English text that detects confidently as `en` (rich in stop-words). */
  const ENGLISH_BODY = 'the cat is on the table and the dog is here with them';

  it('raises the language-mismatch banner when picked language disagrees with text', () => {
    const f = setUp();
    internals(f).text.set(ENGLISH_BODY);
    internals(f).onLanguageChange('de'); // picked German, text is English
    internals(f).submit();
    expect(internals(f).langMismatch()).toEqual({ picked: 'de', detected: 'en' });
  });

  it('"Keep editing" dismisses the banner and does not re-raise on next submit', () => {
    const f = setUp();
    internals(f).text.set(ENGLISH_BODY);
    internals(f).onLanguageChange('de');
    internals(f).submit();
    expect(internals(f).langMismatch()).not.toBeNull();

    internals(f).dismissLangMismatch();
    expect(internals(f).langMismatch()).toBeNull();

    // The exact same mismatch must not pop straight back up: the next submit
    // proceeds to actually post (as the picked language) instead of re-warning.
    internals(f).submit();
    expect(internals(f).langMismatch()).toBeNull();
    const req = httpMock.expectOne('/api/v1/statuses');
    expect(req.request.body.language).toBe('de');
    req.flush({ id: '1' });
  });

  it('re-arms the warning after a dismissal once the picked language changes', () => {
    const f = setUp();
    internals(f).text.set(ENGLISH_BODY);
    internals(f).onLanguageChange('de');
    internals(f).submit();
    internals(f).dismissLangMismatch();

    // Pick a different (still-wrong) language: the dismissal no longer applies.
    internals(f).onLanguageChange('fr');
    internals(f).submit();
    expect(internals(f).langMismatch()).toEqual({ picked: 'fr', detected: 'en' });
  });

  // ------------------------------------------------------- reply mention seeding

  it('seeds the parent author @handle for a reply so it notifies them', () => {
    const f = setUp();
    f.componentRef.setInput('inReplyToId', 's1');
    f.componentRef.setInput('replyToHandle', 'alice@dmv.community');
    f.detectChanges();

    expect(internals(f).text()).toBe('@alice@dmv.community ');
    expect(internals(f).showReplyMentionHint()).toBe(true);
  });

  it('drops the mention hint once the seeded @handle is removed', () => {
    const f = setUp();
    f.componentRef.setInput('inReplyToId', 's1');
    f.componentRef.setInput('replyToHandle', 'alice@dmv.community');
    f.detectChanges();
    expect(internals(f).showReplyMentionHint()).toBe(true);

    // User deletes the handle to reply silently: hint disappears.
    internals(f).text.set('just a quiet thread reply');
    expect(internals(f).showReplyMentionHint()).toBe(false);
  });

  it('does not seed your own handle when replying to yourself', () => {
    TestBed.inject(Auth).account.set({ id: '1', acct: 'me@dmv.community' } as never);
    const f = setUp();
    f.componentRef.setInput('inReplyToId', 's1');
    f.componentRef.setInput('replyToHandle', 'me@dmv.community');
    f.detectChanges();

    expect(internals(f).text()).toBe('');
    expect(internals(f).showReplyMentionHint()).toBe(false);
  });

  it('never shows the mention hint outside a reply (top-level compose)', () => {
    const f = setUp();
    internals(f).text.set('@someone hello');
    // No inReplyToId → not a reply → no hint even if text leads with a mention.
    expect(internals(f).showReplyMentionHint()).toBe(false);
  });

  it('lets an explicit initialText override the auto-seeded reply handle', () => {
    const f = setUp();
    f.componentRef.setInput('inReplyToId', 's1');
    f.componentRef.setInput('replyToHandle', 'alice@dmv.community');
    f.componentRef.setInput('initialText', '@alice@dmv.community @bob@x.social ');
    f.detectChanges();

    // The caller's multi-mention seed wins (e.g. group chat), not the single handle.
    expect(internals(f).text()).toBe('@alice@dmv.community @bob@x.social ');
    expect(internals(f).showReplyMentionHint()).toBe(true);
  });

  // ------------------------------------------------- "Edit for post" handoff
  //
  // The one destructive path in the whole drafts feature. The ordering is the
  // point: publish first, offer to delete second. Delete-then-publish is what
  // the mastodon.social folk recipe does, and it is how people lose posts.

  it('seeds from a pending handoff and offers cleanup only after publishing', () => {
    const drafts = TestBed.inject(Drafts);
    drafts.handoff(
      {
        segments: ['promoted from a private note'],
        spoilerText: '',
        sensitive: false,
        visibility: 'public',
        poll: null,
      },
      'self-99',
    );

    const f = setUp();
    expect(internals(f).text()).toBe('promoted from a private note');
    // Nothing offered yet — the post hasn't happened.
    expect(internals(f).pendingSelfCleanup()).toBeNull();

    internals(f).submit();
    httpMock.expectOne('/api/v1/statuses').flush({ id: 'new-1' });

    expect(internals(f).pendingSelfCleanup()).toBe('self-99');
  });

  it('never offers cleanup when the publish fails', () => {
    const drafts = TestBed.inject(Drafts);
    drafts.handoff(
      {
        segments: ['this will not post'],
        spoilerText: '',
        sensitive: false,
        visibility: 'public',
        poll: null,
      },
      'self-99',
    );
    const f = setUp();

    internals(f).submit();
    httpMock.expectOne('/api/v1/statuses').error(new ProgressEvent('500'));

    // The private copy is still the only copy — it must survive.
    expect(internals(f).pendingSelfCleanup()).toBeNull();
  });

  it('deletes the private copy on confirm', () => {
    const f = setUp();
    internals(f).pendingSelfCleanup.set('self-99');

    internals(f).deleteSelfDraftCopy();

    httpMock.expectOne({ url: '/api/v1/statuses/self-99', method: 'DELETE' }).flush({});
    expect(internals(f).pendingSelfCleanup()).toBeNull();
  });

  it('reports a failed cleanup rather than pretending the copy is gone', () => {
    const f = setUp();
    internals(f).pendingSelfCleanup.set('self-99');

    internals(f).deleteSelfDraftCopy();
    httpMock
      .expectOne({ url: '/api/v1/statuses/self-99', method: 'DELETE' })
      .error(new ProgressEvent('500'));

    expect(internals(f).selfCleanupError()).toContain('still in your messages');
  });

  it('a handoff seeds exactly once and does not survive into the next composer', () => {
    const drafts = TestBed.inject(Drafts);
    drafts.handoff({
      segments: ['one shot'],
      spoilerText: '',
      sensitive: false,
      visibility: 'public',
      poll: null,
    });

    expect(internals(setUp()).text()).toBe('one shot');
    // Drained: a second composer starts empty rather than re-seeding.
    expect(drafts.takeHandoff()).toBeNull();
  });

  // -------------------------------------------------------- thoughtful posting
  //
  // The gate's whole value is that it cannot be walked around. These assert the
  // *absence* of a network call, which is the only thing that really proves it.

  it('a gated composer saves a draft instead of posting', () => {
    TestBed.inject(ClientPrefs).setThoughtfulPosting(true);
    const drafts = TestBed.inject(Drafts);
    const f = TestBed.createComponent(Compose);
    f.componentRef.setInput('gateable', true);
    f.detectChanges();

    internals(f).text.set('a thought worth sitting on');
    internals(f).submit();

    // Nothing was published — httpMock.verify() in afterEach enforces it.
    expect(drafts.drafts()).toHaveLength(1);
    expect(drafts.drafts()[0].segments[0]).toBe('a thought worth sitting on');
    expect(internals(f).text()).toBe('');
  });

  it('an opted-in composer still posts normally while the pref is off', () => {
    const f = TestBed.createComponent(Compose);
    f.componentRef.setInput('gateable', true);
    f.detectChanges();

    internals(f).text.set('ordinary post');
    internals(f).submit();

    httpMock.expectOne('/api/v1/statuses').flush({ id: '1' });
    expect(TestBed.inject(Drafts).drafts()).toHaveLength(0);
  });

  // Replies are urgent; mellowing them in a queue destroys what they're for.
  // A mount that never opts in must be untouched even with the pref on.
  it('a reply is never gated, even with thoughtful posting on', () => {
    TestBed.inject(ClientPrefs).setThoughtfulPosting(true);
    const f = TestBed.createComponent(Compose);
    f.componentRef.setInput('inReplyToId', 'parent-1');
    f.detectChanges();

    internals(f).text.set('urgent reply');
    internals(f).submit();

    httpMock.expectOne('/api/v1/statuses').flush({ id: '2' });
    expect(TestBed.inject(Drafts).drafts()).toHaveLength(0);
  });

  it('a non-opted-in top-level composer (paste share, chat) is not gated', () => {
    TestBed.inject(ClientPrefs).setThoughtfulPosting(true);
    const f = setUp();

    internals(f).text.set('sharing a paste link');
    internals(f).submit();

    httpMock.expectOne('/api/v1/statuses').flush({ id: '3' });
    expect(TestBed.inject(Drafts).drafts()).toHaveLength(0);
  });

  it('a reply composer never swallows a top-level handoff', () => {
    const drafts = TestBed.inject(Drafts);
    drafts.handoff({
      segments: ['meant for the main box'],
      spoilerText: '',
      sensitive: false,
      visibility: 'public',
      poll: null,
    });

    const f = TestBed.createComponent(Compose);
    f.componentRef.setInput('inReplyToId', 'parent-1');
    f.detectChanges();

    expect(internals(f).text()).not.toContain('meant for the main box');
    expect(drafts.takeHandoff()).not.toBeNull();
  });
});

describe('describePostFailure', () => {
  // The bug this guards: every post-failure handler threw the error away, so a
  // server that said exactly why it refused (too long, contains a link,
  // moderated) produced a silent no-op and the user retried forever.
  it('surfaces the server-supplied reason', () => {
    const err = new HttpErrorResponse({
      status: 422,
      error: { error: "Links aren't allowed in posts.", code: 'url_not_allowed' },
    });
    expect(describePostFailure(err).message).toBe("Links aren't allowed in posts.");
  });

  it('parses a JSON body that arrived as a string', () => {
    // Angular leaves the body unparsed when the error response's content type
    // isn't JSON, which real servers get wrong often enough to matter.
    const err = new HttpErrorResponse({
      status: 422,
      error: '{"error":"Too long","code":"unprocessable"}',
    });
    expect(describePostFailure(err).message).toBe('Too long');
  });

  it('prefers error_description when a server sends both', () => {
    const err = new HttpErrorResponse({
      status: 400,
      error: { error: 'invalid_request', error_description: 'Status is over the limit.' },
    });
    expect(describePostFailure(err).message).toBe('Status is over the limit.');
  });

  it('explains an opaque CORS/network failure rather than blaming the post', () => {
    expect(describePostFailure(new HttpErrorResponse({ status: 0 })).message).toContain(
      "Couldn't reach the server",
    );
  });

  it('points a rejected token at reauthentication', () => {
    expect(describePostFailure(new HttpErrorResponse({ status: 401 })).message).toContain(
      'reauthenticate',
    );
  });

  it('falls back to the status code when the body is unusable', () => {
    const err = new HttpErrorResponse({ status: 503, error: '<html>gateway</html>' });
    expect(describePostFailure(err).message).toContain('503');
  });

  // Server-side validation evolves. A client that only understands the codes it
  // was written against gets steadily less useful as new rules appear, so every
  // unrecognized field is surfaced rather than dropped.
  it('surfaces fields it has never seen as labelled detail rows', () => {
    const err = new HttpErrorResponse({
      status: 422,
      error: {
        error: 'That word is not in the dictionary.',
        code: 'word_not_recognized',
        rejected_word: 'speedbomber21',
        suggestion: 'Describe the behaviour instead of naming the person.',
      },
    });

    const failure = describePostFailure(err);
    expect(failure.message).toBe('That word is not in the dictionary.');
    const labels = failure.details.map((d) => d.label);
    expect(labels).toContain('Rejected word');
    expect(labels).toContain('Suggestion');
    expect(failure.details.find((d) => d.label === 'Rejected word')?.value).toBe('speedbomber21');
  });

  it('renders an array value as a readable list', () => {
    const err = new HttpErrorResponse({
      status: 422,
      error: { error: 'Some words were rejected.', unknown_words: ['asdf', 'qwerty'] },
    });
    expect(describePostFailure(err).details[0].value).toBe('asdf, qwerty');
  });

  it('flattens a nested object rather than printing [object Object]', () => {
    const err = new HttpErrorResponse({
      status: 429,
      error: { error: 'Slow down.', limits: { per_minute: 5, retry_after: 30 } },
    });
    const value = describePostFailure(err).details[0].value;
    expect(value).toContain('Per minute: 5');
    expect(value).toContain('Retry after: 30');
  });

  // request_id is for a bug report, not for the person trying to post.
  it('hides plumbing fields from the user', () => {
    const err = new HttpErrorResponse({
      status: 422,
      error: { error: 'Nope.', request_id: 'abc123', field: 'status' },
    });
    const labels = describePostFailure(err).details.map((d) => d.label);
    expect(labels).not.toContain('Request id');
    expect(labels).toContain('Field');
  });

  // A body with no recognized message field still has to reach the user.
  it('still reports a body that names no known message field', () => {
    const err = new HttpErrorResponse({
      status: 422,
      error: { reason_code: 'moderation_hold', review_eta: 'about an hour' },
    });
    const failure = describePostFailure(err);
    expect(failure.message).toContain('rejected');
    expect(failure.details).toHaveLength(2);
  });
});
