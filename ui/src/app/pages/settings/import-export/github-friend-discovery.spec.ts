import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../../../api';
import { Account } from '../../../models';
import { GitHubFollowedUser, GitHubSession } from '../../../providers/github/github-session';
import {
  GitHubFriendDiscovery,
  profileMastodonIdentity,
  rankGitHubMatch,
} from './github-friend-discovery';

function githubUser(login: string, changes: Partial<GitHubFollowedUser> = {}): GitHubFollowedUser {
  return {
    login,
    name: login,
    avatarUrl: `https://avatars.example/${login}`,
    url: `https://github.com/${login}`,
    bio: null,
    websiteUrl: null,
    socialAccounts: { nodes: [] },
    ...changes,
  };
}

function mastodonAccount(username: string, changes: Partial<Account> = {}): Account {
  return {
    id: username,
    username,
    acct: `${username}@social.example`,
    display_name: username,
    note: '',
    url: `https://social.example/@${username}`,
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    fields: [],
    ...changes,
  };
}

describe('GitHub friend identity evidence', () => {
  it('turns a GitHub social-account Mastodon URL into a confirmed handle', () => {
    const identity = profileMastodonIdentity(
      githubUser('alice', {
        socialAccounts: {
          nodes: [
            {
              provider: 'GENERIC',
              displayName: 'Mastodon',
              url: 'https://fosstodon.org/@alice',
            },
          ],
        },
      }),
    );

    expect(identity).toEqual({
      handle: 'alice@fosstodon.org',
      url: 'https://fosstodon.org/@alice',
      evidence: 'Mastodon profile linked from GitHub',
      confidence: 'confirmed',
    });
  });

  it('recognizes a verified Mastodon profile field linking back to GitHub', () => {
    const match = rankGitHubMatch(
      githubUser('hotcoder'),
      mastodonAccount('hotcoder', {
        fields: [
          {
            name: 'GitHub',
            value: '<a href="https://github.com/hotcoder">github.com/hotcoder</a>',
            verified_at: '2026-07-22T00:00:00.000Z',
          },
        ],
      }),
    );

    expect(match.confidence).toBe('confirmed');
    expect(match.signals).toContain('Verified rel=me link back to GitHub');
  });
});

describe('GitHubFriendDiscovery API budget', () => {
  let followedUsers: ReturnType<typeof vi.fn>;
  let search: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    followedUsers = vi.fn();
    search = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: GitHubSession, useValue: { followedUsers } },
        { provide: Api, useValue: { search } },
      ],
    });
  });

  it('paginates GitHub once, completes linked identities, and queues only unmatched profiles', async () => {
    followedUsers
      .mockResolvedValueOnce({
        users: [
          githubUser('linked', { websiteUrl: 'https://mastodon.social/@linked' }),
          githubUser('hotcoder'),
        ],
        hasNextPage: true,
        endCursor: 'page-2',
      })
      .mockResolvedValueOnce({
        users: [githubUser('secondpage')],
        hasNextPage: false,
        endCursor: null,
      });
    const discovery = TestBed.inject(GitHubFriendDiscovery);

    await discovery.load();

    expect(followedUsers).toHaveBeenNthCalledWith(1, null);
    expect(followedUsers).toHaveBeenNthCalledWith(2, 'page-2');
    expect(discovery.githubPageCount()).toBe(2);
    expect(discovery.rows().map((row) => row.status)).toEqual(['complete', 'pending', 'pending']);
    expect(discovery.rows()[0].identity?.handle).toBe('linked@mastodon.social');
    expect(discovery.callCount()).toBe(0);
  });

  it('spends one Mastodon call per unmatched GitHub login and resumes at the budget', async () => {
    followedUsers.mockResolvedValue({
      users: [
        githubUser('linked', { websiteUrl: 'https://mastodon.social/@linked' }),
        githubUser('hotcoder'),
        githubUser('later'),
      ],
      hasNextPage: false,
      endCursor: null,
    });
    search.mockImplementation((query: string) =>
      of({ accounts: [mastodonAccount(query)], statuses: [], hashtags: [] }),
    );
    const discovery = TestBed.inject(GitHubFriendDiscovery);
    discovery.delayMs = 0;
    await discovery.load();

    await discovery.start(1);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('hotcoder', 'accounts', {
      resolve: false,
      limit: 10,
    });
    expect(discovery.callCount()).toBe(1);
    expect(discovery.rows().map((row) => row.status)).toEqual(['complete', 'complete', 'pending']);

    await discovery.start(2);

    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith('later', 'accounts', {
      resolve: false,
      limit: 10,
    });
    expect(discovery.callCount()).toBe(2);
    expect(discovery.rows().every((row) => row.status === 'complete')).toBe(true);
  });
});
