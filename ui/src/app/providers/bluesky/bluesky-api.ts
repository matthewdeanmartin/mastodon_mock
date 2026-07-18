import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { externalFetch } from '../external-fetch';
import { BlueskySession } from './bluesky-session';
import { BskyFacet, BskyThreadNode, BskyTimeline } from './bluesky-types';

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
