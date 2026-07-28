import { Account, Status } from '../../models';
import { PasteCreateInput } from './paste-provider';

/**
 * The shortener stores a redirect target, so a "paste" is really a message
 * encoded into a mawkingbird.com/message/ URL. These helpers are the single
 * encode/decode contract shared by the shortener provider (writes the target)
 * and the /message reader page (reads it back and rebuilds a Mastodon status).
 *
 * Query params (all optional except `m`):
 *   m  - message body (plain text)
 *   cw - content warning / spoiler text (shown as the collapsible CW)
 *   l  - language code (default plaintext)
 */
export interface MessagePayload {
  content: string;
  spoiler: string;
  language: string;
}

const READER_ACCOUNT: Account = {
  id: 'paste:message',
  username: 'message',
  acct: 'message@tinyurl.com',
  display_name: 'Shared message',
  note: 'A message shared as a short link.',
  url: '',
  avatar: 'https://tinyurl.com/favicon.ico',
  avatar_static: 'https://tinyurl.com/favicon.ico',
  header: '',
  followers_count: 0,
  following_count: 0,
  statuses_count: 0,
  bot: false,
  locked: false,
  discoverable: false,
  fields: [],
};

/** Absolute base of the running deployment (origin + base href), ending in `/`. */
function deploymentBase(): string {
  // document.baseURI already folds in the <base href> (/, /canary/, …).
  return document.baseURI.endsWith('/') ? document.baseURI : `${document.baseURI}/`;
}

/**
 * Build the mawkingbird.com/message/ target URL that the shortener will wrap.
 * The compose flow puts any content-warning text in `input.title`, so that maps
 * to the reader's collapsible CW.
 */
export function buildMessageUrl(
  input: Pick<PasteCreateInput, 'title' | 'content' | 'language'>,
  base: string = deploymentBase(),
): string {
  const url = new URL('message/', base);
  // Built by hand rather than with `searchParams.set`, which encodes a space as
  // `+`. This URL's whole job is to survive being passed as the *value* of
  // another query parameter (the shortener's `?url=`), and `+` does not survive
  // that: RFC 3986 says `+` is a literal in a query string, form-encoding says
  // it is a space, and the two hops disagree. `%20` means space everywhere, so
  // the round trip stops depending on who decodes it.
  //
  // Only the encoding changes — readers still parse with URLSearchParams, which
  // handles `%20`, `+` and percent-escapes alike, so nothing here unescapes
  // twice and old links keep working.
  const params = [`m=${strictEncode(input.content)}`];
  if (input.title.trim()) params.push(`cw=${strictEncode(input.title.trim())}`);
  if (input.language && input.language !== 'plaintext') {
    params.push(`l=${strictEncode(input.language)}`);
  }
  url.search = params.join('&');
  return url.toString();
}

/**
 * Percent-encode for a query-string value with no exceptions — notably encoding
 * space as `%20` and never as `+`.
 *
 * `encodeURIComponent` already leaves `!'()*` unescaped; those are sub-delims
 * and legal in a query, but they are escaped here too so the result is inert
 * however many times it is nested inside another URL.
 */
function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Read the message fields out of the reader page's query params. */
export function parseMessageParams(params: URLSearchParams): MessagePayload | null {
  const content = params.get('m');
  if (content === null) return null;
  return {
    content,
    spoiler: params.get('cw') ?? '',
    language: params.get('l') ?? 'plaintext',
  };
}

/**
 * Route-segment scheme for a self-contained message, mirroring the
 * `anonymous-status.` refs: the whole payload is base64url-encoded into a single
 * `/statuses/:id` segment so the native thread page can render it as a real post
 * with no network. This is what lets a shared message open in the same "show a
 * post" view a logged-in user sees for any other status.
 */
const MESSAGE_STATUS_PREFIX = 'message-status.';

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const encoded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode a message payload into a `/statuses/:id` route segment. */
export function messageStatusRouteRef(payload: MessagePayload): string {
  return `${MESSAGE_STATUS_PREFIX}${base64UrlEncode(JSON.stringify(payload))}`;
}

/** Decode a `/statuses/:id` segment back into a message payload, or null. */
export function parseMessageStatusRouteRef(id: string): MessagePayload | null {
  if (!id.startsWith(MESSAGE_STATUS_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      base64UrlDecode(id.slice(MESSAGE_STATUS_PREFIX.length)),
    ) as Partial<MessagePayload>;
    if (typeof parsed?.content !== 'string') return null;
    return {
      content: parsed.content,
      spoiler: typeof parsed.spoiler === 'string' ? parsed.spoiler : '',
      language: typeof parsed.language === 'string' ? parsed.language : 'plaintext',
    };
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Render a decoded message as a Mastodon status for the existing status card. */
export function messageStatus(payload: MessagePayload, sourceUrl: string | null): Status {
  const content = escapeHtml(payload.content).replaceAll('\n', '<br>');
  return {
    provider: 'paste',
    id: 'paste:message:local',
    created_at: new Date().toISOString(),
    edited_at: null,
    content,
    spoiler_text: payload.spoiler,
    visibility: 'unlisted',
    url: sourceUrl,
    account: READER_ACCOUNT,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: !!payload.spoiler,
    poll: null,
    quote_approval_policy: null,
    language: payload.language,
    media_attachments: [],
    application: { name: 'TinyURL link', website: 'https://tinyurl.com' },
  };
}
