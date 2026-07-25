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
  url.searchParams.set('m', input.content);
  if (input.title.trim()) url.searchParams.set('cw', input.title.trim());
  if (input.language && input.language !== 'plaintext') url.searchParams.set('l', input.language);
  return url.toString();
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
