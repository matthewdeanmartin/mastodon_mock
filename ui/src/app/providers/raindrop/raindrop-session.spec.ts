import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Status } from '../../models';
import { firstExternalLink, RaindropSession } from './raindrop-session';

function status(overrides: Partial<Status> = {}): Status {
  return {
    id: '42',
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: '<p>Hello <a href="https://article.example/read">article</a></p>',
    spoiler_text: '',
    visibility: 'public',
    url: 'https://social.example/@alice/42',
    account: {
      id: '1',
      username: 'alice',
      acct: 'alice',
      display_name: 'Alice',
      note: '',
      url: 'https://social.example/@alice',
      avatar: '',
      avatar_static: '',
      header: '',
      followers_count: 0,
      following_count: 0,
      statuses_count: 1,
      bot: false,
      locked: false,
      fields: [],
    },
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

describe('firstExternalLink', () => {
  it('skips hashtags and links to the viewer instance', () => {
    const content = `
      <a class="hashtag" href="https://social.example/tags/angular">#angular</a>
      <a href="https://social.example/@someone/123">local post</a>
      <a href="https://docs.example/guide">the guide</a>
    `;
    expect(firstExternalLink(content, 'https://social.example')).toBe('https://docs.example/guide');
  });

  it('also recognizes hashtag URLs without a hashtag class', () => {
    const content = `
      <a href="https://tags.example/tags/testing">#testing</a>
      <a href="https://news.example/story">story</a>
    `;
    expect(firstExternalLink(content, 'https://social.example')).toBe('https://news.example/story');
  });
});

describe('RaindropSession', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('stores the Test token and removes credentials from the abandoned OAuth flow', () => {
    localStorage.setItem(
      'mockingbird_raindrop_credentials',
      JSON.stringify({ clientId: 'old-id', clientSecret: 'old-secret' }),
    );
    const session = new RaindropSession();
    session.connect(' test-token ');

    expect(session.connected()).toBe(true);
    // Stored alongside a connected-at stamp, which drives credential retention.
    expect(JSON.parse(localStorage.getItem('mockingbird_raindrop_token')!)).toEqual({
      accessToken: 'test-token',
      connectedAt: expect.any(Number),
    });
    expect(localStorage.getItem('mockingbird_raindrop_credentials')).toBeNull();

    session.disconnect();
    expect(session.connected()).toBe(false);
    expect(localStorage.getItem('mockingbird_raindrop_token')).toBeNull();
  });

  it('is shared by every account in the browser, signed in or not', () => {
    // Unscoped: connect while signed in as one account, and the token is the
    // same one the next account (and Anonymous) sees. Raindrop is the person's
    // bookmark drawer, not a per-persona identity.
    localStorage.setItem('mastodon_mock_token', 'token-for-account-one');
    new RaindropSession().connect('test-token');

    localStorage.setItem('mastodon_mock_account_mode', 'anonymous');
    expect(new RaindropSession().connected()).toBe(true);
  });

  it('adopts a token stored under the old per-account key', () => {
    // Before unscoping, the key carried a hash of the active token. Users who
    // had already connected must not be silently logged out of Raindrop.
    localStorage.setItem('mastodon_mock_account_mode', 'anonymous');
    localStorage.setItem(
      'mockingbird_raindrop_token_anonymous',
      JSON.stringify({ accessToken: 'legacy-token', connectedAt: Date.now() }),
    );

    const session = new RaindropSession();

    expect(session.connected()).toBe(true);
    expect(JSON.parse(localStorage.getItem('mockingbird_raindrop_token')!)).toMatchObject({
      accessToken: 'legacy-token',
    });

    // Disconnecting has to clear both, or a reload adopts the old copy again.
    session.disconnect();
    expect(localStorage.getItem('mockingbird_raindrop_token')).toBeNull();
    expect(localStorage.getItem('mockingbird_raindrop_token_anonymous')).toBeNull();
    expect(new RaindropSession().connected()).toBe(false);
  });

  it('saves a post directly with the Test token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: true }), { status: 200 }));
    globalThis.fetch = fetchMock;
    const session = new RaindropSession();
    session.connect('test-token');

    await session.addBookmark(status(), 'post');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.raindrop.io/rest/v1/raindrop',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      link: 'https://social.example/@alice/42',
      excerpt: 'Hello article',
    });
  });

  it('saves only the unwrapped URL when requested', async () => {
    localStorage.setItem(
      'mockingbird_raindrop_token',
      JSON.stringify({ accessToken: 'test-token' }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: true }), { status: 200 }));
    globalThis.fetch = fetchMock;

    await new RaindropSession().addBookmark(
      status(),
      'external-link',
      'https://article.example/read',
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      link: 'https://article.example/read',
      pleaseParse: {},
    });
  });
});
