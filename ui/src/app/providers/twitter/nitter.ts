/**
 * Rewrites x.com links to a Nitter instance.
 *
 * ## Why the app steers away from x.com
 *
 * Sending a reader to x.com undoes much of the point of reading X here. That
 * page carries trackers and a login wall, it is increasingly hostile to logged-
 * out visitors, and clicking through is exactly the habit someone using this
 * connector is trying to break. Mawkingbird cannot host the content itself, but
 * it can point at a front-end that does not do those things.
 *
 * Nitter is a privacy-respecting front-end for Twitter: no JavaScript required, no
 * tracking, no account. `https://x.com/NASA` becomes
 * `https://<instance>/NASA`, and the path shape is otherwise identical —
 * `/user/status/123` works unchanged.
 *
 * ## Why the instance is configurable, and why the default is soft
 *
 * The public Nitter ecosystem is unstable and has been since X closed guest
 * access; instances appear and vanish on a scale of months. That is the same
 * reason `sprint/roadmap-providers.md` decided to treat Nitter as "just an RSS
 * URL the user supplies" rather than build it in.
 *
 * So this ships a default that works today, and lets the user replace it in one
 * field when it stops working. A hardcoded host would turn a dead instance into
 * a dead feature with no recourse; a required setting would make every reader
 * research Nitter instances before their first click. The default is the
 * compromise: working out of the box, replaceable in ten seconds.
 */

const NITTER_HOST_KEY = 'mockingbird_nitter_host';

/**
 * The instance used when the user has not chosen one.
 *
 * Not a promise that it is up — see the note above. It is the most reliable
 * public instance at the time of writing, and the settings field exists
 * precisely because that sentence has a shelf life.
 */
export const DEFAULT_NITTER_HOST = 'nitter.space';

/** Hosts whose links are worth rewriting. */
const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

/** The configured instance host, without scheme or trailing slash. */
export function nitterHost(): string {
  try {
    const stored = localStorage.getItem(NITTER_HOST_KEY)?.trim();
    return stored ? normalizeHost(stored) : DEFAULT_NITTER_HOST;
  } catch {
    return DEFAULT_NITTER_HOST;
  }
}

/** Choose an instance. An empty value restores the default. */
export function setNitterHost(host: string): void {
  const trimmed = host.trim();
  try {
    if (trimmed) {
      localStorage.setItem(NITTER_HOST_KEY, normalizeHost(trimmed));
    } else {
      localStorage.removeItem(NITTER_HOST_KEY);
    }
  } catch {
    // Not persisted; the default applies. Nothing here is worth failing over.
  }
}

/** Strip a scheme, path and trailing slash so only the host survives. */
function normalizeHost(value: string): string {
  return value
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .trim();
}

/**
 * Rewrite an x.com URL onto the configured Nitter instance.
 *
 * Returns the original URL unchanged when it is not an X link or cannot be
 * parsed — this is a convenience, and a link that fails to rewrite should still
 * work rather than break.
 */
export function toNitterUrl(url: string | null | undefined, host = nitterHost()): string | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!X_HOSTS.has(parsed.hostname.toLowerCase())) {
    return url;
  }
  // Path, query and fragment carry over: Nitter mirrors Twitter's URL shape, so
  // `/NASA/status/123` needs no translation.
  return `https://${host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
