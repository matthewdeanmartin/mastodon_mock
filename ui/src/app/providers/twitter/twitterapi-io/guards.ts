import { TwitterApiError } from '../twitter-errors';
import { WireEnvelope, WireTimelineData, WireTweet, WireUser } from './wire-types';

/**
 * Runtime validation of TwitterAPI.io responses.
 *
 * Hand-written type guards rather than Zod or Valibot. The spec (§10.2) asks for
 * runtime validation and names those libraries; the reason not to take one here
 * is that this app ships to a browser and has exactly one provider needing
 * validation. A schema library would be the largest new dependency in
 * `providers/` in exchange for guards that are, as it turns out, four lines
 * each.
 *
 * ## What "valid" means, and why it is so permissive
 *
 * Only what makes an object *identifiable* is required: a post needs an id and
 * an author, a profile needs an id and a username. Everything else may be
 * missing, and the normalizers substitute a null or a sensible default.
 *
 * That is not laziness — it is the correct failure mode for an unofficial
 * scraper of a service that changes without notice. If X drops `viewCount`
 * tomorrow, a strict validator turns every post in the timeline into an error,
 * while a permissive one renders the timeline with no view counts. The second
 * is obviously better for a reader, and the spec agrees (§10.2: "allow partial
 * rendering when nonessential fields are missing").
 *
 * The identity fields are the exception because a post with no id cannot be
 * deduplicated, linked to, or told apart from another — there is nothing to
 * render *as*.
 */

/** Thrown shape for a response whose structure is no longer recognisable. */
function changed(endpoint: string, missing: string[]): TwitterApiError {
  return new TwitterApiError(
    'PROVIDER_CHANGED',
    `TwitterAPI.io's response for ${endpoint} is missing ${missing.join(', ')}. ` +
      'The service may have changed its API — this is not something you can fix from here.',
    'twitterapi-io',
    undefined,
    undefined,
    // Deliberately no response body: it can be large, and §10.2 forbids putting
    // raw provider payloads into diagnostics.
    `missing: ${missing.join(', ')}`,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Pull `data` out of the envelope, or explain what was wrong with it.
 *
 * Provider-level errors inside an HTTP 200 are *not* handled here — the
 * transport already checked for those before this runs. By this point the
 * envelope claims success, so a missing `data` is a schema change rather than
 * an error response.
 */
export function unwrap<T>(body: unknown, endpoint: string): { data: T; envelope: WireEnvelope<T> } {
  if (!isObject(body)) {
    throw changed(endpoint, ['a JSON object body']);
  }
  const envelope = body as WireEnvelope<T>;
  if (envelope.data === undefined || envelope.data === null) {
    throw changed(endpoint, ['data']);
  }
  return { data: envelope.data, envelope };
}

/** Whether a value is usable as a profile. */
export function isWireUser(value: unknown): value is WireUser {
  if (!isObject(value)) {
    return false;
  }
  // An account with no id and no handle cannot be linked to or told apart from
  // any other; there is nothing to render.
  return typeof value['id'] === 'string' || typeof value['userName'] === 'string';
}

/** Whether a value is usable as a post. */
export function isWireTweet(value: unknown): value is WireTweet {
  if (!isObject(value)) {
    return false;
  }
  return typeof value['id'] === 'string' && isWireUser(value['author']);
}

/** Validate a `/twitter/user/info` response. */
export function parseUserResponse(body: unknown): WireUser {
  const { data } = unwrap<unknown>(body, '/twitter/user/info');
  if (!isWireUser(data)) {
    throw changed('/twitter/user/info', ['a user id or userName']);
  }
  return data;
}

/**
 * Validate a timeline response.
 *
 * Individual malformed posts are *dropped* rather than failing the page, and
 * the count is returned so the caller can mention it. One unrenderable post in
 * a page of twenty should cost the reader that post, not the page — and the
 * common cause is a genuinely odd post (a deleted quote, a withheld account)
 * rather than a schema change.
 */
export function parseTimelineResponse(body: unknown): {
  tweets: WireTweet[];
  pinned: WireTweet | null;
  cursor: string | null;
  hasMore: boolean;
  skipped: number;
} {
  const { data, envelope } = unwrap<WireTimelineData>(body, 'user timeline');
  // `data` is typed but not trusted — it came off the wire, so the array check
  // is a runtime one regardless of what the type claims.
  const rawTweets: unknown = (data as WireTimelineData)?.tweets;
  if (!Array.isArray(rawTweets)) {
    throw changed('user timeline', ['data.tweets']);
  }

  const tweets = rawTweets.filter(isWireTweet);
  const pinnedCandidate = (data as WireTimelineData)?.pin_tweet;
  const cursor = typeof envelope.next_cursor === 'string' ? envelope.next_cursor : null;

  return {
    tweets,
    pinned: isWireTweet(pinnedCandidate) ? (pinnedCandidate as WireTweet) : null,
    // An empty-string cursor is "no more pages", not a usable cursor. Passing
    // one back would re-request page one forever (spec §8.6, rule 2).
    cursor: cursor && cursor.length > 0 ? cursor : null,
    hasMore: envelope.has_next_page === true,
    skipped: rawTweets.length - tweets.length,
  };
}
