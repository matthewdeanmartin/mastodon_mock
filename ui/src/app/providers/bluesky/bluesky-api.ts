import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { externalFetch } from '../external-fetch';
import { BlueskySession } from './bluesky-session';
import { BlueskyPostSearch } from './bluesky-post-search';
import {
  BskyAuthorFeedFilter,
  BskyFacet,
  BskyFollowers,
  BskyFollows,
  BskyGeneratorView,
  BskyListView,
  BskyNotificationPage,
  BskyPostView,
  BskyProfile,
  BskySearchActors,
  BskySearchPosts,
  BskyThreadNode,
  BskyTimeline,
} from './bluesky-types';

/**
 * The read-only AppView, which serves auth-optional queries to anyone.
 *
 * Distinct from the `bsky.social` entryway, which requires a session even for
 * endpoints whose lexicon says auth is optional.
 */
/**
 * The public AppView. Answers auth-optional endpoints anonymously, unlike the
 * entryway — see {@link BlueskyApi.publicGet}.
 *
 * Exported because some endpoints must go here *even when signed in*: the
 * `app.bsky.unspecced.*` discovery endpoints are AppView-only, and the entryway
 * answers them 401 `AuthMissing` whoever is asking (measured 2026-08-12).
 */
export const PUBLIC_APPVIEW = 'https://public.api.bsky.app';

interface CreateRecordResponse {
  uri: string;
  cid: string;
}

/** Shared params for the cursor-paged graph list endpoints. */
function peoplePage(actor: string, cursor: string | null): HttpParams {
  const params = new HttpParams().set('actor', actor).set('limit', '50');
  return cursor ? params.set('cursor', cursor) : params;
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
    // `publicGet`, so this also works with no account at all: the public AppView
    // answers an unauthenticated author feed 200 (measured 2026-08-13). That is
    // what lets an anonymous visitor follow a handful of Bluesky accounts and
    // get a real Home feed out of it, with no login on either network.
    return this.publicGet<BskyTimeline>('app.bsky.feed.getAuthorFeed', params);
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
   * The reader's account preferences.
   *
   * How saved feeds are discovered: there is no "my feeds" endpoint, only a
   * `savedFeedsPrefV2` entry inside this list. The union has 16+ member types
   * and grows, so callers must find theirs by `$type` and ignore the rest.
   */
  getPreferences(): Observable<{ preferences: { $type?: string }[] }> {
    return this.get<{ preferences: { $type?: string }[] }>(
      'app.bsky.actor.getPreferences',
      new HttpParams(),
    );
  }

  /** Describe a batch of feed generators — display name, creator, avatar. */
  getFeedGenerators(uris: string[]): Observable<{ feeds: BskyGeneratorView[] }> {
    let params = new HttpParams();
    for (const uri of uris) {
      params = params.append('feeds', uri);
    }
    return this.publicGet<{ feeds: BskyGeneratorView[] }>(
      'app.bsky.feed.getFeedGenerators',
      params,
    );
  }

  /**
   * Feeds that are popular across Bluesky, for discovery.
   *
   * Goes straight to the public AppView rather than through {@link publicGet},
   * and deliberately so: `app.bsky.unspecced.*` is AppView-only, and the
   * entryway answers it 401 `AuthMissing` even for a signed-in caller (measured
   * 2026-08-12). Routing this through `publicGet` would therefore break it for
   * precisely the accounts most likely to want it.
   *
   * `unspecced` is unstable by name — callers must treat a failure as "not
   * available today" and hide the surface, never surface an error.
   */
  getPopularFeedGenerators(limit: number): Observable<{ feeds: BskyGeneratorView[] }> {
    return this.http.get<{ feeds: BskyGeneratorView[] }>(
      `${PUBLIC_APPVIEW}/xrpc/app.bsky.unspecced.getPopularFeedGenerators`,
      { params: new HttpParams().set('limit', String(limit)), context: externalFetch() },
    );
  }

  /** Describe one curated list. */
  getList(uri: string): Observable<{ list: BskyListView }> {
    const params = new HttpParams().set('list', uri).set('limit', '1');
    return this.publicGet<{ list: BskyListView }>('app.bsky.graph.getList', params);
  }

  /**
   * Posts from an algorithmic feed.
   *
   * Returns the same `feedViewPost[]` as `getTimeline`, so `adaptFeedItem`
   * handles it unchanged — the reason this whole feature is cheap.
   */
  getFeed(uri: string, cursor: string | null): Observable<BskyTimeline> {
    let params = new HttpParams().set('feed', uri).set('limit', '30');
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.publicGet<BskyTimeline>('app.bsky.feed.getFeed', params);
  }

  /** Posts from the members of a curated list. Same shape as {@link getFeed}. */
  getListFeed(uri: string, cursor: string | null): Observable<BskyTimeline> {
    let params = new HttpParams().set('list', uri).set('limit', '30');
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.publicGet<BskyTimeline>('app.bsky.feed.getListFeed', params);
  }

  /** Accounts following this actor. Auth-optional, so it works signed out. */
  getFollowers(actor: string, cursor: string | null): Observable<BskyFollowers> {
    return this.publicGet<BskyFollowers>('app.bsky.graph.getFollowers', peoplePage(actor, cursor));
  }

  /**
   * Accounts this actor follows.
   *
   * Note the name: `getFollows` is the *following* list, the mirror of
   * `getFollowers`. Swapping them would mislabel both tabs in a way that looks
   * plausible on screen.
   */
  getFollows(actor: string, cursor: string | null): Observable<BskyFollows> {
    return this.publicGet<BskyFollows>('app.bsky.graph.getFollows', peoplePage(actor, cursor));
  }

  /** Block an actor; returns the block record's at-uri (delete it to unblock). */
  block(did: string): Observable<CreateRecordResponse> {
    return this.createRecord('app.bsky.graph.block', {
      $type: 'app.bsky.graph.block',
      subject: did,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Mute an actor.
   *
   * A procedure, not a record — unlike follow and block there is no at-uri to
   * keep, so unmuting needs only the DID.
   */
  muteActor(did: string): Observable<unknown> {
    return this.request('app.bsky.graph.muteActor', { actor: did });
  }

  unmuteActor(did: string): Observable<unknown> {
    return this.request('app.bsky.graph.unmuteActor', { actor: did });
  }

  /**
   * Search accounts. Works signed out, unlike post search.
   *
   * Returns `profileView`, which carries handle, display name, avatar and bio
   * but **no counts** — those need {@link getProfiles}.
   */
  searchActors(query: string, cursor: string | null): Observable<BskySearchActors> {
    let params = new HttpParams().set('q', query).set('limit', '25');
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.publicGet<BskySearchActors>('app.bsky.actor.searchActors', params);
  }

  /**
   * Detailed profiles for up to 25 actors in one call.
   *
   * How a page of search results gets its follower/following/post counts
   * without one request per row. Signed out the counts still come back; only
   * `viewer` (the follow state) is missing.
   */
  getProfiles(actors: string[]): Observable<{ profiles: BskyProfile[] }> {
    let params = new HttpParams();
    for (const actor of actors) {
      params = params.append('actors', actor);
    }
    return this.publicGet<{ profiles: BskyProfile[] }>('app.bsky.actor.getProfiles', params);
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
    // Anonymous-capable (measured 2026-08-13). The response then carries no
    // `viewer` block, so follow state comes back unknown rather than false —
    // callers must not read a missing viewer as "not following".
    return this.publicGet<BskyProfile>('app.bsky.actor.getProfile', params);
  }

  resolveHandle(handle: string): Observable<{ did: string }> {
    const params = new HttpParams().set('handle', handle);
    // Needed anonymously too: a bare handle has to become a DID before an
    // anonymous follow can be stored against a stable id.
    return this.publicGet<{ did: string }>('com.atproto.identity.resolveHandle', params);
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

  /**
   * XRPC GET that works with or without a linked account.
   *
   * Signed in, this is an ordinary authenticated call. Signed out it goes to
   * the **public AppView**, not the entryway: measured 2026-08-01,
   * `bsky.social` answers an unauthenticated `searchActors` with 401
   * `AuthMissing`, while `public.api.bsky.app` answers it 200. Only endpoints
   * documented as auth-optional may use this — `searchPosts` refuses anonymous
   * callers at both hosts.
   *
   * Anonymous responses omit `viewer`, so no follow state comes back. Callers
   * must treat that as "unknown", not as "not following".
   */
  publicGet<T>(nsid: string, params: HttpParams): Observable<T> {
    if (!this.session.session()) {
      return this.http.get<T>(`${PUBLIC_APPVIEW}/xrpc/${nsid}`, {
        params,
        context: externalFetch(),
      });
    }
    return this.get<T>(nsid, params);
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
