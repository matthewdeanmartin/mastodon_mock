import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, map, mergeMap, Observable, of, throwError, timeout, toArray } from 'rxjs';
import { Auth } from '../../auth';
import { Account, Status } from '../../models';
import { FeedProvider } from '../provider';
import { AnonymousFollow, AnonymousFollows } from './anonymous-follows';
import { RssFetch } from '../rss/rss-fetch';
import { feedToStatuses } from '../rss/rss-adapter';
import { AnonymousAccount } from './anonymous-account';
import { AnonymousTags } from './anonymous-tags';
import { externalFetch } from '../external-fetch';

const PAGE_SIZE = 20;
const MAX_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 8_000;

interface SourceCursor {
  follow: AnonymousFollow;
  maxId?: string;
  exhausted: boolean;
}

interface TagCursor {
  tag: string;
  maxId?: string;
  exhausted: boolean;
}

interface ActiveSource {
  label: string;
  cursor: { exhausted: boolean };
  fetch: () => Observable<Status[]>;
  followKey?: string;
}

export interface AnonymousFollowFeedPage {
  statuses: Status[];
  warnings: string[];
  hasMore: boolean;
}

export interface AnonymousFollowFeedSession {
  fetchPage(): Observable<AnonymousFollowFeedPage>;
}

export interface AnonymousProviderRef {
  server: string;
  statusId: string;
  accountId: string;
}

function host(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

export function adaptAnonymousAccount(account: Account, server: string): Account {
  const accountHost = host(server);
  return {
    ...account,
    acct: account.acct.includes('@') ? account.acct : `${account.username}@${accountHost}`,
  };
}

export function adaptAnonymousStatus(status: Status, server: string): Status {
  const rawId = status.id;
  const account = adaptAnonymousAccount(status.account, server);
  return {
    ...status,
    id: `anonymous-mastodon:${host(server)}:${rawId}`,
    provider: 'anonymous-mastodon',
    providerRef: {
      server,
      statusId: rawId,
      accountId: status.account.id,
    } satisfies AnonymousProviderRef,
    account,
    reblog: status.reblog ? adaptAnonymousStatus(status.reblog, server) : null,
  };
}

/** Pull-based public Mastodon feed for the accounts followed by Anonymous. */
@Injectable({ providedIn: 'root' })
export class AnonymousMastodonProvider implements FeedProvider {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private followStore = inject(AnonymousFollows);
  private tagStore = inject(AnonymousTags);
  private anonymous = inject(AnonymousAccount);
  private rss = inject(RssFetch);

  readonly id = 'anonymous-mastodon' as const;
  readonly label = 'Anonymous Mastodon';
  readonly badge = '🐘 Mastodon';
  readonly linked = computed(
    () => this.auth.isAnonymous && (this.followStore.count() > 0 || this.tagStore.count() > 0),
  );
  readonly errors = signal<string[]>([]);

  private cursors: SourceCursor[] = [];
  private tagCursors: TagCursor[] = [];
  private accountIds = new Map<string, string>();
  private rssFallbacks = new Set<string>();
  private seen = new Set<string>();

  reset(): void {
    this.errors.set([]);
    this.rssFallbacks.clear();
    this.seen.clear();
    this.cursors = this.followStore.follows().map((follow) => ({ follow, exhausted: false }));
    this.tagCursors = this.tagStore.tags().map((tag) => ({ tag, exhausted: false }));
  }

  fetchPage(): Observable<Status[]> {
    const active: ActiveSource[] = [
      ...this.cursors
        .filter((source) => !source.exhausted)
        .map((source) => ({
          label: `@${source.follow.handle}`,
          cursor: source,
          fetch: () => this.fetchSource(source),
          followKey: source.follow.key,
        })),
      ...this.tagCursors
        .filter((source) => !source.exhausted)
        .map((source) => ({
          label: `#${source.tag}`,
          cursor: source,
          fetch: () => this.fetchTag(source),
        })),
    ];
    if (!active.length) {
      return of([]);
    }
    const failures: string[] = [];
    return of(...active).pipe(
      mergeMap(
        (source) =>
          source.fetch().pipe(
            catchError(() => {
              source.cursor.exhausted = true;
              if (source.followKey) this.followStore.markUnavailable(source.followKey);
              failures.push(`Could not load ${source.label}.`);
              return of<Status[]>([]);
            }),
          ),
        MAX_CONCURRENCY,
      ),
      toArray(),
      map((pages) => {
        this.errors.set([
          ...[...this.rssFallbacks].map((handle) => `Using RSS fallback for @${handle}.`),
          ...failures,
        ]);
        return pages
          .flat()
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .filter((status) => {
            const key = status.url || status.id;
            if (this.seen.has(key)) {
              return false;
            }
            this.seen.add(key);
            return true;
          });
      }),
    );
  }

  /** Fetch one public page for an explicit set of follows (used by local lists). */
  fetchFollows(follows: AnonymousFollow[]): Observable<Status[]> {
    return this.createFollowFeed(follows)
      .fetchPage()
      .pipe(map((page) => page.statuses));
  }

  /** Independent, demand-driven cursor set for a local list timeline. */
  createFollowFeed(follows: AnonymousFollow[]): AnonymousFollowFeedSession {
    const cursors: SourceCursor[] = follows.map((follow) => ({ follow, exhausted: false }));
    const seen = new Set<string>();
    return { fetchPage: () => this.fetchFollowFeedPage(cursors, seen) };
  }

  private fetchFollowFeedPage(
    cursors: SourceCursor[],
    seen: Set<string>,
  ): Observable<AnonymousFollowFeedPage> {
    const active = cursors.filter((source) => !source.exhausted);
    if (!active.length) return of({ statuses: [], warnings: [], hasMore: false });
    const warnings: string[] = [];
    return of(...active).pipe(
      mergeMap(
        (source) =>
          this.fetchSource(source).pipe(
            catchError(() => {
              source.exhausted = true;
              this.followStore.markUnavailable(source.follow.key);
              warnings.push(`Could not load @${source.follow.handle}.`);
              return of<Status[]>([]);
            }),
          ),
        MAX_CONCURRENCY,
      ),
      toArray(),
      map((pages) => ({
        statuses: pages
          .flat()
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .filter((status) => {
            const key = status.url || status.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
        warnings,
        hasMore: cursors.some((source) => !source.exhausted),
      })),
    );
  }

  private fetchSource(source: SourceCursor): Observable<Status[]> {
    if (this.followStore.shouldDefer(source.follow)) {
      return throwError(() => new Error('Source is temporarily deferred.'));
    }
    if (this.followStore.prefersRss(source.follow)) {
      return this.fetchRss(source);
    }
    const cachedId = this.accountIds.get(source.follow.key);
    const account$ = cachedId
      ? of(cachedId)
      : this.lookupAccount(source.follow).pipe(
          map((account) => {
            this.accountIds.set(source.follow.key, account.id);
            return account.id;
          }),
        );
    return account$.pipe(
      mergeMap((accountId) => {
        let params = new HttpParams()
          .set('limit', String(PAGE_SIZE))
          .set('exclude_replies', 'true');
        if (source.maxId) {
          params = params.set('max_id', source.maxId);
        }
        return this.http
          .get<Status[]>(`${source.follow.server}/api/v1/accounts/${accountId}/statuses`, {
            params,
            context: externalFetch(),
          })
          .pipe(timeout(REQUEST_TIMEOUT_MS));
      }),
      map((statuses) => {
        this.followStore.markApiSuccess(source.follow.key);
        source.maxId = statuses.at(-1)?.id ?? source.maxId;
        if (statuses.length < PAGE_SIZE) {
          source.exhausted = true;
        }
        return statuses.map((status) => adaptAnonymousStatus(status, source.follow.server));
      }),
      catchError(() => this.fetchRss(source)),
    );
  }

  private fetchRss(source: SourceCursor): Observable<Status[]> {
    const feedUrl = `${source.follow.profileUrl.replace(/\/$/, '')}.rss`;
    return this.rss.fetchFeed(feedUrl).pipe(
      map((feed) => {
        source.exhausted = true;
        this.followStore.markRssFallback(source.follow.key);
        this.rssFallbacks.add(source.follow.handle);
        const fetchedAt = new Date().toISOString();
        return feedToStatuses(feedUrl, feed, fetchedAt).map((status) => ({
          ...status,
          id: `anonymous-mastodon:rss:${status.id}`,
          provider: 'anonymous-mastodon' as const,
          providerRef: {
            server: source.follow.server,
            statusId: status.id,
            accountId: source.follow.account.id,
          },
          account: adaptAnonymousAccount(source.follow.account, source.follow.server),
        }));
      }),
    );
  }

  private fetchTag(source: TagCursor): Observable<Status[]> {
    let params = new HttpParams().set('limit', String(PAGE_SIZE));
    if (source.maxId) {
      params = params.set('max_id', source.maxId);
    }
    const server = this.anonymous.server();
    return this.http
      .get<Status[]>(`${server}/api/v1/timelines/tag/${encodeURIComponent(source.tag)}`, {
        params,
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((statuses) => {
          source.maxId = statuses.at(-1)?.id ?? source.maxId;
          if (statuses.length < PAGE_SIZE) {
            source.exhausted = true;
          }
          return statuses.map((status) => adaptAnonymousStatus(status, server));
        }),
      );
  }

  private lookupAccount(follow: AnonymousFollow): Observable<Account> {
    const params = new HttpParams().set('acct', follow.account.username);
    return this.http
      .get<Account>(`${follow.server}/api/v1/accounts/lookup`, {
        params,
        context: externalFetch(),
      })
      .pipe(timeout(REQUEST_TIMEOUT_MS));
  }
}
