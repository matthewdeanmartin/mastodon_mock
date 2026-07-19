import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, map, mergeMap, Observable, of, timeout, toArray } from 'rxjs';
import { Auth } from '../../auth';
import { Account, Status } from '../../models';
import { FeedProvider } from '../provider';
import { AnonymousFollow, AnonymousFollows } from './anonymous-follows';
import { RssFetch } from '../rss/rss-fetch';
import { feedToStatuses } from '../rss/rss-adapter';

const PAGE_SIZE = 20;
const MAX_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 8_000;

interface SourceCursor {
  follow: AnonymousFollow;
  maxId?: string;
  exhausted: boolean;
}

interface AnonymousProviderRef {
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

function adaptAccount(account: Account, server: string): Account {
  const accountHost = host(server);
  return {
    ...account,
    acct: account.acct.includes('@') ? account.acct : `${account.username}@${accountHost}`,
  };
}

function adaptStatus(status: Status, server: string): Status {
  const rawId = status.id;
  const account = adaptAccount(status.account, server);
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
    reblog: status.reblog ? adaptStatus(status.reblog, server) : null,
  };
}

/** Pull-based public Mastodon feed for the accounts followed by Anonymous. */
@Injectable({ providedIn: 'root' })
export class AnonymousMastodonProvider implements FeedProvider {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private followStore = inject(AnonymousFollows);
  private rss = inject(RssFetch);

  readonly id = 'anonymous-mastodon' as const;
  readonly label = 'Anonymous Mastodon';
  readonly badge = '🐘 Mastodon';
  readonly linked = computed(() => this.auth.isAnonymous && this.followStore.count() > 0);
  readonly errors = signal<string[]>([]);

  private cursors: SourceCursor[] = [];
  private accountIds = new Map<string, string>();
  private rssFallbacks = new Set<string>();
  private seen = new Set<string>();

  reset(): void {
    this.errors.set([]);
    this.rssFallbacks.clear();
    this.seen.clear();
    this.cursors = this.followStore.follows().map((follow) => ({ follow, exhausted: false }));
  }

  fetchPage(): Observable<Status[]> {
    const active = this.cursors.filter((source) => !source.exhausted);
    if (!active.length) {
      return of([]);
    }
    const failures: string[] = [];
    return of(...active).pipe(
      mergeMap(
        (source) =>
          this.fetchSource(source).pipe(
            catchError(() => {
              source.exhausted = true;
              failures.push(`Could not load @${source.follow.handle}.`);
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

  private fetchSource(source: SourceCursor): Observable<Status[]> {
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
          .get<
            Status[]
          >(`${source.follow.server}/api/v1/accounts/${accountId}/statuses`, { params })
          .pipe(timeout(REQUEST_TIMEOUT_MS));
      }),
      map((statuses) => {
        source.maxId = statuses.at(-1)?.id ?? source.maxId;
        if (statuses.length < PAGE_SIZE) {
          source.exhausted = true;
        }
        return statuses.map((status) => adaptStatus(status, source.follow.server));
      }),
      catchError(() => this.fetchRss(source)),
    );
  }

  private fetchRss(source: SourceCursor): Observable<Status[]> {
    const feedUrl = `${source.follow.profileUrl.replace(/\/$/, '')}.rss`;
    return this.rss.fetchFeed(feedUrl).pipe(
      map((feed) => {
        source.exhausted = true;
        this.rssFallbacks.add(source.follow.handle);
        const fetchedAt = new Date().toISOString();
        return feedToStatuses(feedUrl, feed, fetchedAt).map((status) => ({
          ...status,
          id: `anonymous-mastodon:rss:${status.id}`,
          provider: 'anonymous-mastodon' as const,
          providerRef: { server: source.follow.server, statusId: status.id, accountId: '' },
          account: adaptAccount(source.follow.account, source.follow.server),
        }));
      }),
    );
  }

  private lookupAccount(follow: AnonymousFollow): Observable<Account> {
    const params = new HttpParams().set('acct', follow.account.username);
    return this.http
      .get<Account>(`${follow.server}/api/v1/accounts/lookup`, { params })
      .pipe(timeout(REQUEST_TIMEOUT_MS));
  }
}
