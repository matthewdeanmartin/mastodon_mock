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
    expect(localStorage.getItem('mockingbird_raindrop_token')).toBe(
      JSON.stringify({ accessToken: 'test-token' }),
    );
    expect(localStorage.getItem('mockingbird_raindrop_credentials')).toBeNull();

    session.disconnect();
    expect(session.connected()).toBe(false);
    expect(localStorage.getItem('mockingbird_raindrop_token')).toBeNull();
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
