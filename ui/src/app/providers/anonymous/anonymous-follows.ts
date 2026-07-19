import { computed, inject, Injectable, signal } from '@angular/core';
import { Account, Relationship } from '../../models';
import { AnonymousHomeFeedCache } from './anonymous-home-feed-cache';

const STORAGE_KEY = 'mockingbird_anonymous_follows';
const STATE_VERSION = 2;
// Large enough for the shipped starter collection, while still bounding browser-local work.
export const ANONYMOUS_FOLLOW_LIMIT = 50;

export type AnonymousReadRoute = 'read-api' | 'canonical-api' | 'rss';

export interface AnonymousReadRef {
  server: string;
  accountId: string;
}

type RouteRetryAfter = Record<AnonymousReadRoute, string | null>;

export interface AnonymousFollow {
  key: string;
  handle: string;
  server: string;
  profileUrl: string;
  account: Account;
  followedAt: string;
  readRef: AnonymousReadRef;
  routeRetryAfter: RouteRetryAfter;
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

function origin(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function emptyRetryState(): RouteRetryAfter {
  return { 'read-api': null, 'canonical-api': null, rss: null };
}

function validRetryState(value: unknown): value is RouteRetryAfter {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<RouteRetryAfter>;
  return [state['read-api'], state['canonical-api'], state.rss].every(
    (retryAfter) => retryAfter === null || typeof retryAfter === 'string',
  );
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
        typeof item.readRef?.server === 'string' &&
        typeof item.readRef?.accountId === 'string' &&
        !!origin(item.readRef.server) &&
        validRetryState(item.routeRetryAfter) &&
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
  private homeFeedCache = inject(AnonymousHomeFeedCache);

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

  routeDeferred(follow: AnonymousFollow, route: AnonymousReadRoute): boolean {
    const retryAfter = follow.routeRetryAfter[route];
    return !!retryAfter && Date.parse(retryAfter) > Date.now();
  }

  hasBackoff(follow: AnonymousFollow): boolean {
    return (Object.keys(follow.routeRetryAfter) as AnonymousReadRoute[]).some((route) =>
      this.routeDeferred(follow, route),
    );
  }

  markApiSuccess(key: string, readRef: AnonymousReadRef): void {
    this.updateFollow(key, (follow) => ({
      ...follow,
      readRef,
      routeRetryAfter: { ...follow.routeRetryAfter, 'read-api': null, 'canonical-api': null },
    }));
  }

  markRouteFailure(key: string, route: AnonymousReadRoute): void {
    this.updateFollow(key, (follow) => {
      if (this.routeDeferred(follow, route)) return follow;
      return {
        ...follow,
        routeRetryAfter: {
          ...follow.routeRetryAfter,
          [route]: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
      };
    });
  }

  /** User-requested, one-shot retry. The next page load will try the public API again. */
  clearBackoff(key: string): void {
    this.updateFollow(key, (follow) => ({ ...follow, routeRetryAfter: emptyRetryState() }));
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
    const readServer = origin(fallbackServer) ?? server;
    const follow: AnonymousFollow = {
      key,
      handle: `${account.username}@${host}`,
      server,
      profileUrl: account.url || `${server}/@${account.username}`,
      account: { ...account, acct: `${account.username}@${host}` },
      followedAt: new Date().toISOString(),
      readRef: { server: readServer, accountId: account.id },
      routeRetryAfter: emptyRetryState(),
    };
    this.homeFeedCache.invalidate();
    this.persist([...this.follows(), follow]);
    return { ok: true, relationship: relationship(account.id, true) };
  }

  unfollow(account: Account, fallbackServer: string): Relationship {
    const key = keyFor(account, fallbackServer);
    if (this.follows().some((follow) => follow.key === key)) this.homeFeedCache.invalidate();
    this.persist(this.follows().filter((follow) => follow.key !== key));
    return relationship(account.id, false);
  }

  private persist(follows: AnonymousFollow[]): void {
    const state: AnonymousFollowState = { version: STATE_VERSION, follows };
    this.state.set(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  private updateFollow(key: string, update: (follow: AnonymousFollow) => AnonymousFollow): void {
    this.persist(this.follows().map((follow) => (follow.key === key ? update(follow) : follow)));
  }
}
