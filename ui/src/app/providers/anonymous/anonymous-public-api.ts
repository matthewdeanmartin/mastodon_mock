import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, timeout } from 'rxjs';
import { AccountStatusesOptions } from '../../api';
import { Account, Collection, Context, SearchResults, Status, Tag } from '../../models';
import { externalFetch } from '../external-fetch';
import { adaptAnonymousAccount, adaptAnonymousStatus } from './anonymous-mastodon-provider';
import { AnonymousPublicRef } from './anonymous-route-ref';

const REQUEST_TIMEOUT_MS = 8_000;
const ANONYMOUS_POST_SEARCH_TAG_LIMIT = 10;

function searchTags(query: string): string[] {
  return [
    ...new Set((query.match(/[\p{L}\p{N}_]+/gu) ?? []).map((word) => word.toLocaleLowerCase())),
  ].slice(0, ANONYMOUS_POST_SEARCH_TAG_LIMIT);
}

/** Read-only public Mastodon API calls used by Anonymous profile and thread routes. */
@Injectable({ providedIn: 'root' })
export class AnonymousPublicApi {
  private http = inject(HttpClient);

  getAccount(ref: AnonymousPublicRef): Observable<Account> {
    return this.http
      .get<Account>(`${ref.server}/api/v1/accounts/${encodeURIComponent(ref.id)}`, {
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((account) => adaptAnonymousAccount(account, ref.server)),
      );
  }

  getAccountFollowers(ref: AnonymousPublicRef, maxId?: string): Observable<Account[]> {
    return this.getAccountPeople(ref, 'followers', maxId);
  }

  getAccountFollowing(ref: AnonymousPublicRef, maxId?: string): Observable<Account[]> {
    return this.getAccountPeople(ref, 'following', maxId);
  }

  /** Discoverable Collections curated by a public account (Mastodon 4.6+). */
  getAccountCollections(ref: AnonymousPublicRef): Observable<Collection[]> {
    return this.http
      .get<{ collections: Collection[] }>(
        `${ref.server}/api/v1/accounts/${encodeURIComponent(ref.id)}/collections`,
        { context: externalFetch() },
      )
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((response) => response.collections ?? []),
      );
  }

  getAccountStatuses(
    ref: AnonymousPublicRef,
    opts: AccountStatusesOptions = {},
  ): Observable<Status[]> {
    let params = new HttpParams();
    if (opts.excludeReplies) params = params.set('exclude_replies', 'true');
    if (opts.excludeReblogs) params = params.set('exclude_reblogs', 'true');
    if (opts.pinned) params = params.set('pinned', 'true');
    if (opts.maxId) params = params.set('max_id', opts.maxId);
    if (opts.limit) params = params.set('limit', String(opts.limit));
    return this.http
      .get<Status[]>(`${ref.server}/api/v1/accounts/${encodeURIComponent(ref.id)}/statuses`, {
        params,
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((statuses) => statuses.map((status) => adaptAnonymousStatus(status, ref.server))),
      );
  }

  getStatus(ref: AnonymousPublicRef): Observable<Status> {
    return this.http
      .get<Status>(`${ref.server}/api/v1/statuses/${encodeURIComponent(ref.id)}`, {
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((status) => adaptAnonymousStatus(status, ref.server)),
      );
  }

  getContext(ref: AnonymousPublicRef): Observable<Context> {
    return this.http
      .get<Context>(`${ref.server}/api/v1/statuses/${encodeURIComponent(ref.id)}/context`, {
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((context) => ({
          ancestors: context.ancestors.map((status) => adaptAnonymousStatus(status, ref.server)),
          descendants: context.descendants.map((status) =>
            adaptAnonymousStatus(status, ref.server),
          ),
        })),
      );
  }

  getTag(server: string, name: string): Observable<Tag> {
    return this.http
      .get<Tag>(`${server}/api/v1/tags/${encodeURIComponent(name)}`, {
        context: externalFetch(),
      })
      .pipe(timeout(REQUEST_TIMEOUT_MS));
  }

  getTagTimeline(server: string, name: string, maxId?: string): Observable<Status[]> {
    let params = new HttpParams().set('limit', '20');
    if (maxId) params = params.set('max_id', maxId);
    return this.http
      .get<Status[]>(`${server}/api/v1/timelines/tag/${encodeURIComponent(name)}`, {
        params,
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((statuses) => statuses.map((status) => adaptAnonymousStatus(status, server))),
      );
  }

  /** Approximate anonymous post search by merging one public hashtag timeline per query word. */
  searchPostsByHashtags(server: string, query: string): Observable<SearchResults> {
    const tags = searchTags(query);
    if (!tags.length) {
      return of({ accounts: [], statuses: [], hashtags: [] });
    }
    return forkJoin(
      tags.map((tag) => this.getTagTimeline(server, tag).pipe(catchError(() => of<Status[]>([])))),
    ).pipe(
      map((pages) => {
        const byUrl = new Map<string, Status>();
        for (const status of pages.flat()) {
          const key = status.url || status.id;
          if (!byUrl.has(key)) byUrl.set(key, status);
        }
        return {
          accounts: [],
          statuses: [...byUrl.values()].sort(
            (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
          ),
          hashtags: tags.map((name) => ({
            name,
            url: `${server}/tags/${encodeURIComponent(name)}`,
          })),
        };
      }),
    );
  }

  search(
    server: string,
    query: string,
    type: 'accounts' | 'statuses' | 'hashtags',
  ): Observable<SearchResults> {
    const params = new HttpParams().set('q', query).set('type', type);
    return this.http
      .get<SearchResults>(`${server}/api/v2/search`, { params, context: externalFetch() })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((results) => ({
          accounts: results.accounts.map((account) => adaptAnonymousAccount(account, server)),
          statuses: results.statuses.map((status) => adaptAnonymousStatus(status, server)),
          hashtags: results.hashtags,
        })),
      );
  }

  private getAccountPeople(
    ref: AnonymousPublicRef,
    kind: 'followers' | 'following',
    maxId?: string,
  ): Observable<Account[]> {
    let params = new HttpParams().set('limit', '80');
    if (maxId) params = params.set('max_id', maxId);
    return this.http
      .get<
        Account[]
      >(`${ref.server}/api/v1/accounts/${encodeURIComponent(ref.id)}/${kind}`, { params, context: externalFetch() })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((accounts) => accounts.map((account) => adaptAnonymousAccount(account, ref.server))),
      );
  }
}
