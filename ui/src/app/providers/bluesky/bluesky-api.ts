import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { externalFetch } from '../external-fetch';
import { BlueskySession } from './bluesky-session';
import { BlueskyPostSearch } from './bluesky-post-search';
import {
  BskyAuthorFeedFilter,
  BskyFacet,
  BskyNotificationPage,
  BskyPostView,
  BskyProfile,
  BskySearchPosts,
  BskyThreadNode,
  BskyTimeline,
} from './bluesky-types';

interface CreateRecordResponse {
  uri: string;
  cid: string;
}

/** Split an at-uri (`at://did/collection/rkey`) into deleteRecord params. */
function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } {
  const [repo, collection, rkey] = uri.replace('at://', '').split('/');
  return { repo, collection, rkey };
}

function isExpiredToken(err: unknown): boolean {
  return (
    err instanceof HttpErrorResponse &&
    (err.status === 401 ||
      (err.status === 400 && (err.error as { error?: string } | null)?.error === 'ExpiredToken'))
  );
}

/**
 * Thin authenticated XRPC client against the linked account's PDS. Every call
 * retries once through a token refresh when the access token has expired.
 */
@Injectable({ providedIn: 'root' })
export class BlueskyApi {
  private http = inject(HttpClient);
  private session = inject(BlueskySession);

  getTimeline(cursor: string | null): Observable<BskyTimeline> {
    let params = new HttpParams().set('limit', '20');
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.get<BskyTimeline>('app.bsky.feed.getTimeline', params);
  }

  /**
   * One actor's own posts, cursor-paged like the timeline.
   *
   * `filter` is applied by the server, so "hide replies" is a different query
   * rather than a client-side filter over a fixed page — which matters when
   * paging: dropping replies locally would return short pages and eventually an
   * empty one that looks like the end of the history.
   */
  getAuthorFeed(
    actor: string,
    cursor: string | null,
    filter: BskyAuthorFeedFilter = 'posts_and_author_threads',
  ): Observable<BskyTimeline> {
    let params = new HttpParams().set('actor', actor).set('limit', '20').set('filter', filter);
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.get<BskyTimeline>('app.bsky.feed.getAuthorFeed', params);
  }

  /**
   * Search posts.
   *
   * **Requires auth**: measured 2026-08-01, anonymous calls get 403 from
   * `public.api.bsky.app` and 401 from the entryway. So this is offered only
   * with a linked account, unlike `searchActors`.
   *
   * Every criterion is a typed parameter rather than a DSL string appended to
   * `q` — the object is canonical and the query is derived, the same rule the
   * Mastodon serializer follows. Empty fields are omitted entirely: sending
   * `author=` blank is a different query from sending nothing.
   */
  searchPosts(criteria: BlueskyPostSearch, cursor: string | null): Observable<BskySearchPosts> {
    let params = new HttpParams().set('q', criteria.text).set('limit', '25');
    const single: [string, string | undefined][] = [
      // Handles are resolved server-side, so a bare handle is fine; a leading
      // @ is not, and readers type one.
      ['author', criteria.author?.replace(/^@/, '')],
      ['mentions', criteria.mentions?.replace(/^@/, '')],
      ['lang', criteria.language],
      ['domain', criteria.domain],
      ['url', criteria.url],
      // Date-only bounds are accepted and honoured (measured), so the existing
      // YYYY-MM-DD pickers need no widening to ISO instants.
      ['since', criteria.after],
      ['until', criteria.before],
      ['sort', criteria.sort],
    ];
    for (const [key, value] of single) {
      if (value) {
        params = params.set(key, value);
      }
    }
    for (const tag of criteria.tags ?? []) {
      params = params.append('tag', tag);
    }
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.get<BskySearchPosts>('app.bsky.feed.searchPosts', params);
  }

  /**
   * One page of notifications.
   *
   * Verified 2026-08-01 to answer at the `bsky.social` entryway, so no PDS
   * resolution is needed — unlike chat, which is service-proxied and must hit
   * the account's real PDS.
   */
  listNotifications(cursor: string | null): Observable<BskyNotificationPage> {
    let params = new HttpParams().set('limit', '30');
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.get<BskyNotificationPage>('app.bsky.notification.listNotifications', params);
  }

  /** How many notifications have arrived since `updateSeen`. */
  getUnreadCount(): Observable<{ count: number }> {
    return this.get<{ count: number }>('app.bsky.notification.getUnreadCount', new HttpParams());
  }

  /** Mark everything up to now as seen, clearing the unread badge. */
  updateSeen(seenAt = new Date().toISOString()): Observable<unknown> {
    return this.request('app.bsky.notification.updateSeen', { seenAt });
  }

  /**
   * Hydrate posts by at-uri, up to 25 per call.
   *
   * **Returns only what it finds, in its own order.** Nine uris yielded eight
   * posts in live testing: one was a repost record rather than a post, and it
   * was dropped with no error and no placeholder. Callers must key the result
   * by uri, never by index.
   */
  getPosts(uris: string[]): Observable<{ posts: BskyPostView[] }> {
    let params = new HttpParams();
    for (const uri of uris) {
      params = params.append('uris', uri);
    }
    return this.get<{ posts: BskyPostView[] }>('app.bsky.feed.getPosts', params);
  }

  /**
   * Follow an actor by DID; returns the follow record's at-uri.
   *
   * That uri is the handle for undoing it — Bluesky has no `unfollow` verb, only
   * "delete the record you created" — so callers must keep it. It also comes back
   * on any later `getProfile` as `viewer.following`, which is how a fresh page
   * load knows.
   */
  follow(did: string): Observable<CreateRecordResponse> {
    return this.createRecord('app.bsky.graph.follow', {
      $type: 'app.bsky.graph.follow',
      subject: did,
      createdAt: new Date().toISOString(),
    });
  }

  /** Full thread (ancestors + replies) for a post's at-uri. */
  getPostThread(uri: string): Observable<{ thread: BskyThreadNode }> {
    const params = new HttpParams().set('uri', uri).set('depth', '50');
    return this.get<{ thread: BskyThreadNode }>('app.bsky.feed.getPostThread', params);
  }

  /** Like a post; returns the like record's at-uri (needed to unlike). */
  like(uri: string, cid: string): Observable<CreateRecordResponse> {
    return this.createRecord('app.bsky.feed.like', {
      $type: 'app.bsky.feed.like',
      subject: { uri, cid },
      createdAt: new Date().toISOString(),
    });
  }

  repost(uri: string, cid: string): Observable<CreateRecordResponse> {
    return this.createRecord('app.bsky.feed.repost', {
      $type: 'app.bsky.feed.repost',
      subject: { uri, cid },
      createdAt: new Date().toISOString(),
    });
  }

  /** Publish a post record (used for replies; Mockingbird has no top-level bsky compose). */
  post(record: {
    text: string;
    facets?: BskyFacet[];
    reply?: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } };
  }): Observable<CreateRecordResponse> {
    return this.createRecord('app.bsky.feed.post', {
      $type: 'app.bsky.feed.post',
      createdAt: new Date().toISOString(),
      ...record,
    });
  }

  /** Delete any owned record (a like, a repost, a post) by its at-uri. */
  deleteRecord(atUri: string): Observable<unknown> {
    return this.request('com.atproto.repo.deleteRecord', parseAtUri(atUri));
  }

  /**
   * A detailed actor profile — bio, avatar, banner and the three counts. Defaults
   * to the linked account itself, which is what the left rail's card wants.
   */
  getProfile(actor?: string): Observable<BskyProfile> {
    const target = actor ?? this.session.session()?.did ?? '';
    const params = new HttpParams().set('actor', target);
    return this.get<BskyProfile>('app.bsky.actor.getProfile', params);
  }

  resolveHandle(handle: string): Observable<{ did: string }> {
    const params = new HttpParams().set('handle', handle);
    return this.get<{ did: string }>('com.atproto.identity.resolveHandle', params);
  }

  private createRecord(
    collection: string,
    record: Record<string, unknown>,
  ): Observable<CreateRecordResponse> {
    const did = this.session.session()?.did ?? '';
    return this.request<CreateRecordResponse>('com.atproto.repo.createRecord', {
      repo: did,
      collection,
      record,
    });
  }

  /**
   * Authenticated XRPC GET. Extra headers support service proxying (chat),
   * which also needs `serviceUrl`: proxied calls only work against the
   * account's real PDS host, not the bsky.social entryway.
   */
  get<T>(
    nsid: string,
    params: HttpParams,
    extraHeaders: Record<string, string> = {},
    serviceUrl?: string,
  ): Observable<T> {
    return this.withRefresh((jwt) =>
      this.http.get<T>(`${serviceUrl ?? this.service()}/xrpc/${nsid}`, {
        params,
        headers: { Authorization: `Bearer ${jwt}`, ...extraHeaders },
        context: externalFetch(),
      }),
    );
  }

  /** Authenticated XRPC procedure call (POST). */
  request<T>(
    nsid: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
    serviceUrl?: string,
  ): Observable<T> {
    return this.withRefresh((jwt) =>
      this.http.post<T>(`${serviceUrl ?? this.service()}/xrpc/${nsid}`, body, {
        headers: { Authorization: `Bearer ${jwt}`, ...extraHeaders },
        context: externalFetch(),
      }),
    );
  }

  private withRefresh<T>(call: (jwt: string) => Observable<T>): Observable<T> {
    const session = this.session.session();
    if (!session) {
      return throwError(() => new Error('No Bluesky account linked.'));
    }
    return call(session.accessJwt).pipe(
      catchError((err: unknown) =>
        isExpiredToken(err)
          ? this.session.refresh().pipe(switchMap((fresh) => call(fresh.accessJwt)))
          : throwError(() => err),
      ),
    );
  }

  private service(): string {
    return this.session.session()?.service ?? 'https://bsky.social';
  }
}
