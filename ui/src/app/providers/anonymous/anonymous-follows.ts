import { computed, Injectable, signal } from '@angular/core';
import { Account, Relationship } from '../../models';

const STORAGE_KEY = 'mockingbird_anonymous_follows';
const STATE_VERSION = 1;
export const ANONYMOUS_FOLLOW_LIMIT = 20;

export interface AnonymousFollow {
  key: string;
  handle: string;
  server: string;
  profileUrl: string;
  account: Account;
  followedAt: string;
  preferredSource: 'api' | 'rss';
  apiRetryAfter: string | null;
}

interface AnonymousFollowState {
  version: typeof STATE_VERSION;
  follows: AnonymousFollow[];
}

export type FollowResult =
  | { ok: true; relationship: Relationship }
  | { ok: false; relationship: Relationship; error: string };

function hostFromAccount(account: Account, fallbackServer: string): string {
  try {
    if (account.url) {
      return new URL(account.url).host.toLowerCase();
    }
  } catch {
    // Fall through to the federated handle or selected home instance.
  }
  const acctHost = account.acct.includes('@') ? account.acct.split('@').at(-1) : null;
  if (acctHost) {
    return acctHost.toLowerCase();
  }
  try {
    return new URL(fallbackServer).host.toLowerCase();
  } catch {
    return 'mastodon.social';
  }
}

function serverFor(host: string, account: Account): string {
  try {
    if (account.url) {
      return new URL(account.url).origin;
    }
  } catch {
    // A synthesized HTTPS origin is the safest fallback for a federated handle.
  }
  return `https://${host}`;
}

function keyFor(account: Account, fallbackServer: string): string {
  return `${account.username.toLowerCase()}@${hostFromAccount(account, fallbackServer)}`;
}

function relationship(id: string, following: boolean): Relationship {
  return {
    id,
    following,
    followed_by: false,
    requested: false,
    blocking: false,
    muting: false,
  };
}

function loadState(): AnonymousFollowState {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<AnonymousFollowState> | null;
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.follows)) {
      return { version: STATE_VERSION, follows: [] };
    }
    const follows = parsed.follows.filter(
      (item): item is AnonymousFollow =>
        typeof item?.key === 'string' &&
        typeof item.server === 'string' &&
        typeof item.profileUrl === 'string' &&
        typeof item.account?.username === 'string',
    );
    return { version: STATE_VERSION, follows: follows.slice(0, ANONYMOUS_FOLLOW_LIMIT) };
  } catch {
    return { version: STATE_VERSION, follows: [] };
  }
}

/** Owns Anonymous Mastodon relationships; no server mutation ever leaves this service. */
@Injectable({ providedIn: 'root' })
export class AnonymousFollows {
  private state = signal(loadState());

  readonly follows = computed(() => this.state().follows);
  readonly count = computed(() => this.follows().length);

  isFollowing(account: Account, fallbackServer: string): boolean {
    const key = keyFor(account, fallbackServer);
    return this.follows().some((follow) => follow.key === key);
  }

  relationship(account: Account, fallbackServer: string): Relationship {
    return relationship(account.id, this.isFollowing(account, fallbackServer));
  }

  findByAccountId(accountId: string): AnonymousFollow | null {
    return this.follows().find((follow) => follow.account.id === accountId) ?? null;
  }

  shouldDefer(follow: AnonymousFollow): boolean {
    return (
      follow.preferredSource === 'api' &&
      !!follow.apiRetryAfter &&
      Date.parse(follow.apiRetryAfter) > Date.now()
    );
  }

  prefersRss(follow: AnonymousFollow): boolean {
    return (
      follow.preferredSource === 'rss' &&
      !!follow.apiRetryAfter &&
      Date.parse(follow.apiRetryAfter) > Date.now()
    );
  }

  markApiSuccess(key: string): void {
    this.updateSource(key, 'api', null);
  }

  markRssFallback(key: string): void {
    this.updateSource(key, 'rss', new Date(Date.now() + 15 * 60_000).toISOString());
  }

  markUnavailable(key: string): void {
    const follow = this.follows().find((item) => item.key === key);
    if (follow?.apiRetryAfter && Date.parse(follow.apiRetryAfter) > Date.now()) return;
    this.updateSource(key, 'api', new Date(Date.now() + 15 * 60_000).toISOString());
  }

  follow(account: Account, fallbackServer: string): FollowResult {
    const key = keyFor(account, fallbackServer);
    if (this.follows().some((follow) => follow.key === key)) {
      return { ok: true, relationship: relationship(account.id, true) };
    }
    if (this.count() >= ANONYMOUS_FOLLOW_LIMIT) {
      return {
        ok: false,
        relationship: relationship(account.id, false),
        error: `Anonymous accounts can follow up to ${ANONYMOUS_FOLLOW_LIMIT} Mastodon accounts.`,
      };
    }
    const host = hostFromAccount(account, fallbackServer);
    const server = serverFor(host, account);
    const follow: AnonymousFollow = {
      key,
      handle: `${account.username}@${host}`,
      server,
      profileUrl: account.url || `${server}/@${account.username}`,
      account: { ...account, acct: `${account.username}@${host}` },
      followedAt: new Date().toISOString(),
      preferredSource: 'api',
      apiRetryAfter: null,
    };
    this.persist([...this.follows(), follow]);
    return { ok: true, relationship: relationship(account.id, true) };
  }

  unfollow(account: Account, fallbackServer: string): Relationship {
    const key = keyFor(account, fallbackServer);
    this.persist(this.follows().filter((follow) => follow.key !== key));
    return relationship(account.id, false);
  }

  private persist(follows: AnonymousFollow[]): void {
    const state: AnonymousFollowState = { version: STATE_VERSION, follows };
    this.state.set(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  private updateSource(
    key: string,
    preferredSource: AnonymousFollow['preferredSource'],
    apiRetryAfter: string | null,
  ): void {
    this.persist(
      this.follows().map((follow) =>
        follow.key === key ? { ...follow, preferredSource, apiRetryAfter } : follow,
      ),
    );
  }
}
