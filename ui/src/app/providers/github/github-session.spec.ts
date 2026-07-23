import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubSession } from './github-session';

const USER = {
  login: 'octocat',
  avatar_url: 'https://avatars.example/octocat',
  html_url: 'https://github.com/octocat',
  name: 'The Octocat',
};

describe('GitHubSession', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('validates and stores a classic token without exposing it through public state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(USER), { status: 200 }),
    );
    const session = TestBed.inject(GitHubSession);

    await session.connect(' ghp_secret ');

    expect(session.connected()).toBe(true);
    expect(session.user()?.login).toBe('octocat');
    expect(localStorage.getItem('mockingbird_github_token')).toContain('ghp_secret');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghp_secret' }),
      }),
    );
  });

  it('does not store a token rejected by GitHub', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
    );
    const session = TestBed.inject(GitHubSession);

    await expect(session.connect('bad-token')).rejects.toThrow('GitHub rejected that token');

    expect(session.connected()).toBe(false);
    expect(localStorage.getItem('mockingbird_github_token')).toBeNull();
  });

  it('proves notification and following API calls work directly from the browser', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(USER), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'notification-1' }]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([USER]), { status: 200 }));
    const session = TestBed.inject(GitHubSession);
    await session.connect('ghp_secret');

    await session.runProof();

    expect(session.notifications()).toHaveLength(1);
    expect(session.following()?.[0].login).toBe('octocat');
  });

  it('loads followed-user profile clues through one GraphQL page', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(USER), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              viewer: {
                following: {
                  nodes: [
                    {
                      login: 'friend',
                      name: 'Friend',
                      avatarUrl: 'https://avatars.example/friend',
                      url: 'https://github.com/friend',
                      bio: null,
                      websiteUrl: 'https://social.example/@friend',
                      socialAccounts: { nodes: [] },
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: 'next-page' },
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const session = TestBed.inject(GitHubSession);
    await session.connect('ghp_secret');

    const page = await session.followedUsers(null);

    expect(page.users[0].login).toBe('friend');
    expect(page).toMatchObject({ hasNextPage: true, endCursor: 'next-page' });
    expect(fetch).toHaveBeenLastCalledWith(
      'https://api.github.com/graphql',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"cursor":null'),
      }),
    );
  });

  it('disconnects and forgets all proof data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(USER), { status: 200 }),
    );
    const session = TestBed.inject(GitHubSession);
    await session.connect('ghp_secret');

    session.disconnect();

    expect(session.connected()).toBe(false);
    expect(session.user()).toBeNull();
    expect(localStorage.getItem('mockingbird_github_token')).toBeNull();
  });
});
