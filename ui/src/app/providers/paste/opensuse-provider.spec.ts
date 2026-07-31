import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpensuseProvider } from './opensuse-provider';
import { PasteFeedSubscriptions } from './paste-feed-subscriptions';
import { PasteRecentItem } from './paste-provider';

const FEED = 'https://paste.opensuse.org/pastes.json';

/** One entry shaped like the live endpoint's, overridable per test. */
function paste(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 147680,
    author: 'Smiling Eagle',
    user_id: null,
    title: 'Anonymous paste',
    private: false,
    created_at: '2026-07-28T18:54:35.757Z',
    // Active Storage blob path — deliberately NOT the paste body.
    content: '/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJ',
    human_url: 'https://paste.opensuse.org/pastes/6ab8f3346826',
    ...over,
  };
}

describe('OpensuseProvider', () => {
  let provider: OpensuseProvider;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    provider = TestBed.inject(OpensuseProvider);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function fetchRecent(body: object): {
    items?: PasteRecentItem[];
    error?: Error;
  } {
    const out: { items?: PasteRecentItem[]; error?: Error } = {};
    provider.recent().subscribe({
      next: (items) => (out.items = items),
      error: (err: Error) => (out.error = err),
    });
    http.expectOne(FEED).flush(body);
    return out;
  }

  it('maps the feed into recent items', () => {
    const { items } = fetchRecent([paste()]);

    expect(items).toHaveLength(1);
    expect(items?.[0].slug).toBe('6ab8f3346826');
    expect(items?.[0].title).toBe('Anonymous paste');
    expect(items?.[0].url).toBe('https://paste.opensuse.org/pastes/6ab8f3346826');
    expect(items?.[0].rawUrl).toBe('https://paste.opensuse.org/pastes/6ab8f3346826/raw');
  });

  it('never puts the blob redirect path in the preview', () => {
    // `content` is a signed Active Storage URL, not the paste text. Printing it
    // would dump an opaque token into the timeline.
    const { items } = fetchRecent([paste()]);

    expect(items?.[0].preview).toBe('Posted by Smiling Eagle');
    expect(items?.[0].preview).not.toContain('active_storage');
  });

  it('falls back to a neutral preview when there is no author', () => {
    const { items } = fetchRecent([paste({ author: null })]);

    expect(items?.[0].preview).toBe('Public paste');
  });

  it('drops private pastes', () => {
    const { items } = fetchRecent([paste({ private: true }), paste({ id: 2, private: false })]);

    expect(items).toHaveLength(1);
  });

  it('drops entries with no URL rather than emitting a broken link', () => {
    const { items } = fetchRecent([paste({ human_url: null })]);

    expect(items).toEqual([]);
  });

  it('reports a changed API shape instead of rendering an empty feed', () => {
    // A 200 that is not the documented array means the service changed. Showing
    // "no pastes" would look healthy and be a lie.
    const { error, items } = fetchRecent({ pastes: [] });

    expect(items).toBeUndefined();
    expect(error?.message).toContain('changed its API');
  });

  it('explains a CORS failure and points at the proxy', () => {
    const out: { error?: Error } = {};
    provider.recent().subscribe({ error: (err: Error) => (out.error = err) });
    // status 0 is what a blocked cross-origin request looks like in a browser.
    http.expectOne(FEED).error(new ProgressEvent('error'), { status: 0, statusText: '' });

    expect(out.error?.message).toContain('cross-origin');
    expect(out.error?.message).toContain('CORS proxy');
  });

  it('fetches directly until the feed is opted in to the proxy', () => {
    // No proxy configured and no opt-in: the request must go to the real URL.
    fetchRecent([paste()]);
    // http.expectOne(FEED) inside fetchRecent already asserts the direct URL.
  });

  it('builds a status carrying the paste title', () => {
    const { items } = fetchRecent([paste({ title: 'kernel <panic>' })]);
    const status = provider.status(items![0]);

    expect(status.provider).toBe('paste');
    expect(status.url).toBe('https://paste.opensuse.org/pastes/6ab8f3346826');
    // Titles are user input and must not reach the DOM as markup.
    expect(status.content).toContain('kernel &lt;panic&gt;');
    expect(status.content).not.toContain('<panic>');
  });

  it('refuses to create, because the service has no create API', () => {
    const out: { error?: Error } = {};
    provider
      .create({
        title: 't',
        content: 'c',
        language: 'plaintext',
        expiry: 'never',
        visibility: 'public',
      })
      .subscribe({ error: (err: Error) => (out.error = err) });

    expect(out.error?.message).toContain('read-only');
  });

  it('is registered as a feed the user can subscribe to', () => {
    const subs = TestBed.inject(PasteFeedSubscriptions);
    subs.follow(provider.id, provider.feedUrl, provider.label);

    expect(subs.has('opensuse')).toBe(true);
  });
});
