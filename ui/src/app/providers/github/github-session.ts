import { Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';
import {
  credentialExpired,
  credentialExpiresAt,
  ensureStamped,
  ExpiringCredential,
  ExpiringConnection,
  stampCredential,
} from '../credential-lifetime';

/**
 * Split so a settings export can carry the linked identity without the token:
 * the user profile is `private`, the PAT is `secret`. See `storage-registry.ts`.
 */
const USER_KEY_BASE = 'mockingbird_github_user';
const CREDENTIALS_KEY_BASE = 'mockingbird_github_credentials';
const API_ROOT = 'https://api.github.com';
const API_VERSION = '2026-03-10';

/** The secret half, plus the retention stamp that governs it. */
interface StoredGitHubCredentials extends ExpiringCredential {
  accessToken: string;
}

/** Both halves rejoined, as the service holds them in memory. */
interface StoredGitHubToken extends StoredGitHubCredentials {
  user: GitHubUser;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
}

export interface GitHubNotification {
  id: string;
  reason: string;
  unread: boolean;
  updated_at: string;
  repository: {
    full_name: string;
    html_url: string;
  };
  subject: {
    title: string;
    type: string;
    url: string | null;
  };
}

export interface GitHubSocialAccount {
  provider: string;
  displayName: string | null;
  url: string;
}

export interface GitHubFollowedUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
  bio: string | null;
  websiteUrl: string | null;
  socialAccounts: {
    nodes: GitHubSocialAccount[];
  };
}

export interface GitHubFollowingPage {
  users: GitHubFollowedUser[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface GitHubStarredRepository {
  nameWithOwner: string;
  url: string;
  description: string | null;
}

export interface GitHubStarredOwner {
  profile: GitHubFollowedUser;
  repositories: GitHubStarredRepository[];
}

export interface GitHubStarredOwnerPage {
  owners: GitHubStarredOwner[];
  repositoryCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GitHubGraphQlResponse {
  data?: {
    viewer?: {
      following?: {
        nodes: GitHubFollowedUser[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
      starredRepositories?: {
        nodes: {
          nameWithOwner: string;
          url: string;
          description: string | null;
          owner: GitHubFollowedUser & {
            description?: string | null;
            socialAccounts?: { nodes: GitHubSocialAccount[] };
          };
        }[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    };
  };
  errors?: { message: string }[];
}

/** Browser-only GitHub REST session using a user-supplied classic token. */
@Injectable({ providedIn: 'root' })
export class GitHubSession implements ExpiringConnection {
  private readonly userKey = scopedKey(USER_KEY_BASE);
  private readonly credentialsKey = scopedKey(CREDENTIALS_KEY_BASE);
  private token = signal<StoredGitHubToken | null>(readToken(this.userKey, this.credentialsKey));

  readonly user = signal<GitHubUser | null>(this.token()?.user ?? null);
  readonly connected = signal(this.token() !== null);
  readonly notifications = signal<GitHubNotification[] | null>(null);
  readonly following = signal<GitHubUser[] | null>(null);

  async connect(accessToken: string): Promise<GitHubUser> {
    const trimmed = accessToken.trim();
    if (!trimmed) {
      throw new Error('Paste a GitHub personal access token (classic).');
    }

    const user = await githubRequest<GitHubUser>('/user', trimmed);
    const credentials = stampCredential({ accessToken: trimmed });
    localStorage.setItem(this.userKey, JSON.stringify(user));
    localStorage.setItem(this.credentialsKey, JSON.stringify(credentials));
    const stored: StoredGitHubToken = { ...credentials, user };
    this.token.set(stored);
    this.user.set(user);
    this.connected.set(true);
    return user;
  }

  /** When this token ages out under the retention policy, or null. */
  expiresAt(): number | null {
    return credentialExpiresAt(this.token()?.connectedAt);
  }

  /** Drop the token if it has outlived the retention policy. */
  enforceLifetime(): void {
    const token = this.token();
    if (token && credentialExpired(token.connectedAt)) {
      this.disconnect();
    }
  }

  async runProof(): Promise<void> {
    const accessToken = this.token()?.accessToken;
    if (!accessToken) {
      throw new Error('Connect GitHub first.');
    }

    try {
      const [notifications, following] = await Promise.all([
        githubRequest<GitHubNotification[]>(
          '/notifications?all=false&participating=false&per_page=10',
          accessToken,
        ),
        githubRequest<GitHubUser[]>('/user/following?per_page=10', accessToken),
      ]);
      this.notifications.set(notifications);
      this.following.set(following);
    } catch (error: unknown) {
      if (error instanceof GitHubApiError && error.status === 401) {
        this.disconnect();
      }
      throw error;
    }
  }

  async followedUsers(cursor: string | null = null): Promise<GitHubFollowingPage> {
    const body = await this.graphQl(FOLLOWED_USERS_QUERY, cursor);
    const following = body.data?.viewer?.following;
    if (!following) {
      throw new Error(body.errors?.[0]?.message ?? 'GitHub did not return followed accounts.');
    }
    return {
      users: following.nodes,
      hasNextPage: following.pageInfo.hasNextPage,
      endCursor: following.pageInfo.endCursor,
    };
  }

  async starredRepositoryOwners(cursor: string | null = null): Promise<GitHubStarredOwnerPage> {
    const body = await this.graphQl(STARRED_REPOSITORY_OWNERS_QUERY, cursor);
    const starred = body.data?.viewer?.starredRepositories;
    if (!starred) {
      throw new Error(
        body.errors?.[0]?.message ?? 'GitHub did not return your starred repositories.',
      );
    }
    const owners = new Map<string, GitHubStarredOwner>();
    for (const repository of starred.nodes) {
      const profile = {
        ...repository.owner,
        bio: repository.owner.bio ?? repository.owner.description ?? null,
        socialAccounts: repository.owner.socialAccounts ?? { nodes: [] },
      };
      const key = profile.login.toLowerCase();
      const existing = owners.get(key);
      const context = {
        nameWithOwner: repository.nameWithOwner,
        url: repository.url,
        description: repository.description,
      };
      if (existing) {
        existing.repositories.push(context);
      } else {
        owners.set(key, { profile, repositories: [context] });
      }
    }
    return {
      owners: [...owners.values()],
      repositoryCount: starred.nodes.length,
      hasNextPage: starred.pageInfo.hasNextPage,
      endCursor: starred.pageInfo.endCursor,
    };
  }

  disconnect(): void {
    localStorage.removeItem(this.userKey);
    localStorage.removeItem(this.credentialsKey);
    this.token.set(null);
    this.user.set(null);
    this.connected.set(false);
    this.notifications.set(null);
    this.following.set(null);
  }

  private async graphQl(query: string, cursor: string | null): Promise<GitHubGraphQlResponse> {
    const accessToken = this.token()?.accessToken;
    if (!accessToken) {
      throw new Error('Connect GitHub first.');
    }
    const response = await fetch(`${API_ROOT}/graphql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': API_VERSION,
      },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    if (!response.ok) {
      if (response.status === 401) this.disconnect();
      throw new GitHubApiError(response.status, await githubError(response));
    }
    return (await response.json()) as GitHubGraphQlResponse;
  }
}

const FOLLOWED_USERS_QUERY = `
  query FollowedUsers($cursor: String) {
    viewer {
      following(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          login
          name
          avatarUrl
          url
          bio
          websiteUrl
          socialAccounts(first: 10) {
            nodes {
              provider
              displayName
              url
            }
          }
        }
      }
    }
  }
`;

const STARRED_REPOSITORY_OWNERS_QUERY = `
  query StarredRepositoryOwners($cursor: String) {
    viewer {
      starredRepositories(
        first: 100
        after: $cursor
        orderBy: { field: STARRED_AT, direction: DESC }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          nameWithOwner
          url
          description
          owner {
            login
            avatarUrl
            url
            ... on User {
              name
              bio
              websiteUrl
              socialAccounts(first: 10) {
                nodes {
                  provider
                  displayName
                  url
                }
              }
            }
            ... on Organization {
              name
              description
              websiteUrl
            }
          }
        }
      }
    }
  }
`;

class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function githubRequest<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    },
  });
  if (!response.ok) {
    throw new GitHubApiError(response.status, await githubError(response));
  }
  return (await response.json()) as T;
}

async function githubError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (response.status === 401) {
      return 'GitHub rejected that token. Check that it is active, then try again.';
    }
    if (response.status === 403 && body.message?.toLowerCase().includes('scope')) {
      return 'That token is missing the notifications scope.';
    }
    return body.message ?? `GitHub returned HTTP ${response.status}.`;
  } catch {
    return `GitHub returned HTTP ${response.status}.`;
  }
}

/**
 * Rejoin the two halves. A profile with no token is not a usable connection, so
 * the orphan is cleared — the state a machine that imported settings but has not
 * reconnected GitHub yet will be in.
 */
function readToken(userKey: string, credentialsKey: string): StoredGitHubToken | null {
  try {
    const user = JSON.parse(localStorage.getItem(userKey) ?? 'null') as GitHubUser | null;
    const credentials = JSON.parse(
      localStorage.getItem(credentialsKey) ?? 'null',
    ) as Partial<StoredGitHubCredentials> | null;
    if (
      typeof credentials?.accessToken !== 'string' ||
      !credentials.accessToken ||
      typeof user?.login !== 'string'
    ) {
      localStorage.removeItem(userKey);
      localStorage.removeItem(credentialsKey);
      return null;
    }
    const stamped = ensureStamped(credentialsKey, credentials as StoredGitHubCredentials);
    if (credentialExpired(stamped.connectedAt)) {
      localStorage.removeItem(userKey);
      localStorage.removeItem(credentialsKey);
      return null;
    }
    return { ...stamped, user };
  } catch {
    localStorage.removeItem(userKey);
    localStorage.removeItem(credentialsKey);
    return null;
  }
}
