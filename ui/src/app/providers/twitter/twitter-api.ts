import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { Account, Status } from '../../models';
import { parseTimelineResponse, parseUserResponse } from './twitterapi-io/guards';
import { toAccount, toStatus } from './twitterapi-io/normalizers';
import { TwitterTransport } from './twitter-transport';

/** One page of a timeline, plus what is needed to ask for the next. */
export interface TwitterPage {
  statuses: Status[];
  /** Opaque provider cursor. Never parsed, modified, or reused across endpoints. */
  cursor: string | null;
  hasMore: boolean;
  /** Posts dropped because they were unrenderable, so the UI can say so. */
  skipped: number;
}

/**
 * The read operations Mawkingbird actually uses, in Mastodon shapes.
 *
 * Thin on purpose: it validates, normalizes, and returns `Status`/`Account`.
 * All the interesting decisions live either below it (the transport's
 * proxy-first rule) or beside it (the normalizers). Nothing above this layer
 * learns that X, or a scraper reselling it, exists.
 *
 * ## Why there is no `getPost`, `search`, or `getFollowers` yet
 *
 * Each is a billable call and a fixture nobody has captured. They are cheap to
 * add once there is a screen that needs one, and adding them now would mean
 * shipping normalizers validated against imagined responses — the exact mistake
 * this integration has been avoiding by measuring first.
 */
@Injectable({ providedIn: 'root' })
export class TwitterApi {
  private transport = inject(TwitterTransport);

  /**
   * Look up a profile by handle.
   *
   * Costs one request. The caller should cache the resulting numeric id: every
   * timeline fetch by handle makes the provider do this same lookup internally,
   * and §6.5 notes the id-based endpoint is faster for exactly that reason.
   */
  getProfile(username: string): Observable<Account> {
    return this.transport
      .request<unknown>({
        path: '/twitter/user/info',
        params: { userName: stripAt(username) },
      })
      .pipe(map((body) => toAccount(parseUserResponse(body))));
  }

  /**
   * A user's posts, newest first — their Posts tab, not a home feed.
   *
   * Uses the by-id endpoint when a numeric id is known, per §6.5, and falls back
   * to the by-handle one before the first profile lookup has happened.
   */
  getUserPosts(
    ref: { userId?: string; username?: string },
    cursor?: string,
  ): Observable<TwitterPage> {
    const byId = !!ref.userId;
    return this.transport
      .request<unknown>({
        path: byId ? '/twitter/user/tweet_timeline' : '/twitter/user/last_tweets',
        params: byId
          ? { userId: ref.userId, cursor }
          : { userName: stripAt(ref.username ?? ''), cursor },
      })
      .pipe(
        map((body) => {
          const page = parseTimelineResponse(body);
          return {
            statuses: page.tweets.map((tweet) => toStatus(tweet)),
            cursor: page.cursor,
            hasMore: page.hasMore,
            skipped: page.skipped,
          };
        }),
      );
  }
}

/** Handles are stored and sent without the `@`, however the user typed them. */
export function stripAt(username: string): string {
  return username.trim().replace(/^@+/, '');
}
