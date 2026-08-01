import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { Account, Status } from '../../models';
import {
  parsePostsResponse,
  parseTimelineResponse,
  parseUserResponse,
} from './twitterapi-io/guards';
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

  /**
   * One post by id.
   *
   * Used only on a *cold* thread load — a reload, or a link someone shared —
   * where the feed cache has nothing. Navigating from a card never calls this,
   * because the post is already in hand.
   *
   * The endpoint is the batch one (`tweet_ids` takes a comma-separated list);
   * asking for a single id is the documented way to fetch one post.
   */
  getPost(tweetId: string): Observable<Status | null> {
    return this.transport
      .request<unknown>({ path: '/twitter/tweets', params: { tweet_ids: tweetId } })
      .pipe(
        map((body) => {
          const tweets = parsePostsResponse(body);
          return tweets[0] ? toStatus(tweets[0]) : null;
        }),
      );
  }

  /**
   * Direct replies to a post, oldest first.
   *
   * One request, 6 credits. Deliberately *only* the replies: walking up to the
   * conversation root would cost one request per ancestor level with no way to
   * know the depth in advance, which is exactly the unbounded chain §6.10 warns
   * about. The thread page instead offers a link to the full conversation on
   * Nitter, which costs nothing.
   */
  getReplies(tweetId: string, cursor?: string): Observable<TwitterPage> {
    return this.transport
      .request<unknown>({
        path: '/twitter/tweet/replies',
        params: { tweetId, cursor },
      })
      .pipe(
        map((body) => {
          const page = parseTimelineResponse(body);
          return {
            statuses: page.tweets
              .map((tweet) => toStatus(tweet))
              // Oldest first, so a thread reads top to bottom like every other
              // conversation view in this app.
              .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
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
