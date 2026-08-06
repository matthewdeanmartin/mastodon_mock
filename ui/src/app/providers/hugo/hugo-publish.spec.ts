import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account } from '../../models';
import { decodeBase64 } from './hugo-contents';
import { parseFrontMatter } from './hugo-front-matter';
import { HugoPublish } from './hugo-publish';
import { HugoRepo, HugoSettings } from './hugo-settings';

const REPO: HugoRepo = {
  owner: 'mistersql',
  repo: 'my-blog',
  branch: 'main',
  contentPath: 'content/posts',
  siteUrl: 'https://mistersql.github.io/my-blog/',
  includeInProfile: false,
};

const ACCOUNT = { id: '1', acct: 'mistersql', username: 'mistersql' } as Account;

function created(status = 200): Response {
  return new Response(
    JSON.stringify({
      content: { path: 'content/posts/x.md', sha: 'blob', html_url: 'https://github.com/file' },
      commit: { sha: 'commit-abc' },
    }),
    { status },
  );
}

function conflict(): Response {
  return new Response(JSON.stringify({ message: 'already exists' }), { status: 422 });
}

/**
 * Only the commits this connector made.
 *
 * Two things pollute a positional index into `mock.calls`: TestBed construction
 * fires unrelated fetches of its own (the bundled server list, joinmastodon's
 * directory), and reads share the mock with writes. Filtering to GitHub `PUT`s
 * is the stable way to ask "what did we actually publish".
 */
function githubCalls(): [string, RequestInit][] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      (call): call is [string, RequestInit] =>
        typeof call[0] === 'string' &&
        call[0].startsWith('https://api.github.com/') &&
        (call[1] as RequestInit | undefined)?.method === 'PUT',
    );
}

/** The file body sent on the Nth GitHub call. */
function sentFile(call = 0): string {
  const [, init] = githubCalls()[call];
  return decodeBase64(JSON.parse(init.body as string).content);
}

function sentPath(call = 0): string {
  return githubCalls()[call][0];
}

function connect(): HugoPublish {
  TestBed.inject(HugoSettings).connect('github_pat_secret', REPO);
  return TestBed.inject(HugoPublish);
}

describe('HugoPublish', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('commits a post with TOML front matter and returns a blog Status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(created());
    const publish = connect();

    const result = await publish.publish({
      title: 'Hello World',
      body: 'First post. #hugo',
      isDraft: false,
      account: ACCOUNT,
    });

    const parsed = parseFrontMatter(sentFile());
    expect(parsed.format).toBe('toml');
    expect(parsed.title).toBe('Hello World');
    expect(parsed.draft).toBe(false);
    expect(parsed.tags).toEqual(['hugo']);
    expect(parsed.body).toBe('First post. #hugo');

    expect(sentPath()).toContain('/contents/content/posts/hello-world.md');
    expect(result.slug).toBe('hello-world');
    expect(result.renamed).toBe(false);
    expect(result.status.id).toBe('blog:hugo:hello-world');
    expect(result.status.provider).toBe('blog');
    expect(result.status.url).toBe('https://mistersql.github.io/my-blog/posts/hello-world/');
    expect(result.status.providerRef).toMatchObject({
      providerId: 'hugo',
      commitSha: 'commit-abc',
      contentSha: 'blob',
    });
  });

  it('marks a draft in front matter and keeps it out of public visibility', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(created());
    const publish = connect();

    const result = await publish.publish({
      title: 'Half finished',
      body: 'Notes.',
      isDraft: true,
      account: ACCOUNT,
    });

    expect(parseFrontMatter(sentFile()).draft).toBe(true);
    expect(result.status.visibility).toBe('private');
  });

  it('links to the file on GitHub when no site address is configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(created());
    TestBed.inject(HugoSettings).connect('t', { ...REPO, siteUrl: null });

    const result = await TestBed.inject(HugoPublish).publish({
      title: 'Hello',
      body: 'x',
      isDraft: false,
      account: ACCOUNT,
    });

    expect(result.status.url).toBe('https://github.com/file');
  });

  it('retries a colliding slug with a numbered suffix and says so', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(created());
    const publish = connect();

    const result = await publish.publish({
      title: 'Hello World',
      body: 'Again.',
      isDraft: false,
      account: ACCOUNT,
    });

    expect(sentPath(0)).toContain('hello-world.md');
    expect(sentPath(1)).toContain('hello-world-2.md');
    expect(result.slug).toBe('hello-world-2');
    expect(result.renamed).toBe(true);
  });

  it('gives up after three collisions rather than looping', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(conflict());
    const publish = connect();

    await expect(
      publish.publish({ title: 'Hello', body: 'x', isDraft: false, account: ACCOUNT }),
    ).rejects.toThrow(/already posts named/);

    expect(githubCalls()).toHaveLength(3);
  });

  it('does not retry an error that is not a collision', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
    );
    const publish = connect();

    await expect(
      publish.publish({ title: 'Hello', body: 'x', isDraft: false, account: ACCOUNT }),
    ).rejects.toThrow(/rejected that token/);

    expect(githubCalls()).toHaveLength(1);
  });

  it('refuses an empty title or body before making any request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(created());
    const publish = connect();

    await expect(
      publish.publish({ title: '  ', body: 'x', isDraft: false, account: ACCOUNT }),
    ).rejects.toThrow(/title/i);
    await expect(
      publish.publish({ title: 'Hello', body: '  ', isDraft: false, account: ACCOUNT }),
    ).rejects.toThrow(/publish/i);

    expect(githubCalls()).toHaveLength(0);
  });

  it('refuses to publish with no repository connected', async () => {
    const publish = TestBed.inject(HugoPublish);

    await expect(
      publish.publish({ title: 'Hello', body: 'x', isDraft: false, account: ACCOUNT }),
    ).rejects.toThrow(/Settings/);
  });

  it('survives a title that slugifies to nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(created());
    const publish = connect();

    const result = await publish.publish({
      title: '日本語のタイトル',
      body: 'Body.',
      isDraft: false,
      account: ACCOUNT,
    });

    expect(result.slug).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{4}$/);
    // The title itself survives intact in the front matter even though the
    // slug could not be derived from it.
    expect(parseFrontMatter(sentFile()).title).toBe('日本語のタイトル');
  });
});
