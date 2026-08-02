/**
 * Every host Mawkingbird might need to reach, and a cheap way to ask each one
 * "are you reachable from this network?".
 *
 * ## Why this page exists
 *
 * Setting up a connector costs real effort: make an account, generate a key,
 * sometimes pay for credits, paste it in — and only then discover that this
 * network drops the host entirely and none of it was ever going to work.
 * Repeat per connector. The doctor turns that into one sweep you can run
 * before spending anything, on a fresh install, with no credentials at all.
 *
 * Which is why every probe here is **unauthenticated by construction**. Not as
 * a convenience: a doctor that needed keys could not answer the question it
 * exists to answer, since the whole point is to run it *before* you have them.
 *
 * ## What a browser can actually observe
 *
 * Very little, and this file is careful not to claim more. A cross-origin
 * request that fails reports `status: 0` and nothing else — deliberately, since
 * the detail is itself cross-origin information. Corporate DNS blackholing, a
 * firewall drop, being offline, an extension cancelling the request and a
 * genuinely dead service are indistinguishable from JavaScript.
 *
 * So the probes run with `mode: 'no-cors'`, which discards the response body
 * but keeps the one bit that matters: an opaque response means DNS resolved,
 * TCP connected and TLS completed. That is *reachability*, which is the only
 * question this page asks. It deliberately does not use the app's real
 * transports (unlike {@link TwitterReachability}, which is a "will this feature
 * work?" check and must exercise the exact path a real request takes).
 *
 * The second half of the answer comes from the user: a top-level navigation is
 * not subject to CORS, so opening the host in a tab shows the browser's own
 * error page — a corporate block page, a certificate warning, `DNS_PROBE_
 * FINISHED_NXDOMAIN`. Those pages are privileged and unreadable from script, so
 * the user reports what they saw and {@link interpret} combines the two.
 *
 * The tab also reveals things that are not error pages at all. A Cloudflare
 * "verify you are human" interstitial is the important one, and it is why
 * `bot-check` is a first-class outcome: it exonerates the network completely
 * while still meaning the connector cannot work, which is a combination none of
 * the other answers can express.
 */

/** Groups the probe list so a blocked *category* is visible at a glance. */
export type ProbeCategory = 'core' | 'connector' | 'proxy' | 'shortener' | 'control';

export interface ProbeTarget {
  /** Stable identity, and the key results are stored under. */
  id: string;
  /** The host, as the user would type it. Shown as the row's title. */
  host: string;
  /** Which connector or feature this host belongs to, in the user's terms. */
  label: string;
  category: ProbeCategory;
  /**
   * The URL the JS probe fetches. Always an unauthenticated, side-effect-free
   * path — usually a public discovery or health endpoint. In `no-cors` mode the
   * response is unreadable, so this only ever proves the host answered.
   */
  probeUrl: string;
  /**
   * Where "Open in a tab" sends the user. Deliberately a *human* page rather
   * than {@link probeUrl}: an API endpoint renders as raw JSON or a 404, which
   * looks alarming and teaches nothing, while the service's own homepage is
   * unmistakably either itself or a block page.
   */
  openUrl: string;
  /** One clause: what stops working if this host is unreachable. */
  matters: string;
}

/**
 * The Mastodon instance you are signed into, which is not catalog data — it is
 * whatever server the user picked, so the caller supplies it.
 *
 * Returns null for the built-in mock (an empty base URL means same-origin, and
 * probing your own origin proves nothing).
 */
export function homeServerTarget(baseUrl: string): ProbeTarget | null {
  if (!baseUrl) {
    return null;
  }
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return null;
  }
  return {
    id: 'home',
    host,
    label: 'Your Mastodon server',
    category: 'core',
    // Public, unauthenticated, and the one endpoint every Mastodon server has.
    probeUrl: `${baseUrl}/api/v1/instance`,
    openUrl: `${baseUrl}/about`,
    matters: 'Everything. Without this there is no timeline to read.',
  };
}

/**
 * Hosts that do not depend on which server you are on.
 *
 * Ordered by category rather than alphabetically, so the summary reads as
 * "connectors fine, proxies blocked" rather than as a flat list of fifteen
 * hostnames.
 */
export const PROBE_TARGETS: readonly ProbeTarget[] = [
  {
    id: 'bsky-social',
    host: 'bsky.social',
    label: 'Bluesky (sign-in)',
    category: 'connector',
    // describeServer is the AT Protocol's unauthenticated "who are you" call.
    probeUrl: 'https://bsky.social/xrpc/com.atproto.server.describeServer',
    openUrl: 'https://bsky.social',
    matters: 'Signing in to Bluesky, and posting.',
  },
  {
    id: 'bsky-appview',
    host: 'public.api.bsky.app',
    label: 'Bluesky (reading)',
    category: 'connector',
    // The public AppView answers this without a token; it is how anonymous
    // Bluesky reading works here at all.
    probeUrl: 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app',
    openUrl: 'https://bsky.app',
    matters: 'Reading Bluesky posts and profiles.',
  },
  {
    id: 'openrouter',
    host: 'openrouter.ai',
    label: 'OpenRouter (AI)',
    category: 'connector',
    // The model list is public and needs no key — exactly the property this
    // page depends on.
    probeUrl: 'https://openrouter.ai/api/v1/models',
    openUrl: 'https://openrouter.ai',
    matters: 'Plain-English search, hashtag suggestions and translation.',
  },
  {
    id: 'twitterapi',
    host: 'api.twitterapi.io',
    label: 'Twitter data service',
    category: 'connector',
    probeUrl: 'https://api.twitterapi.io/',
    openUrl: 'https://twitterapi.io',
    matters: 'Reading public tweets. Also needs a CORS proxy.',
  },
  {
    id: 'raindrop',
    host: 'api.raindrop.io',
    label: 'Raindrop.io',
    category: 'connector',
    probeUrl: 'https://api.raindrop.io/',
    openUrl: 'https://raindrop.io',
    matters: 'Saving bookmarks to Raindrop.',
  },
  {
    id: 'github',
    host: 'api.github.com',
    label: 'GitHub',
    category: 'connector',
    // The API root is unauthenticated and returns a link index.
    probeUrl: 'https://api.github.com/',
    openUrl: 'https://github.com',
    matters: 'Finding the people you follow on GitHub.',
  },
  {
    id: 'dropbox',
    host: 'api.dropboxapi.com',
    label: 'Dropbox',
    category: 'connector',
    probeUrl: 'https://api.dropboxapi.com/',
    openUrl: 'https://www.dropbox.com',
    matters: 'Browsing your Dropbox app folder.',
  },
  {
    id: 'allorigins',
    host: 'api.allorigins.win',
    label: 'AllOrigins proxy',
    category: 'proxy',
    probeUrl: 'https://api.allorigins.win/raw?url=https%3A%2F%2Fexample.com',
    openUrl: 'https://allorigins.win/',
    matters: 'The no-signup CORS proxy, used for RSS feeds that block browsers.',
  },
  {
    id: 'corssh',
    host: 'proxy.cors.sh',
    label: 'CORS.SH proxy',
    category: 'proxy',
    probeUrl: 'https://proxy.cors.sh/https://example.com',
    openUrl: 'https://cors.sh/',
    matters: 'A CORS proxy that can carry API keys.',
  },
  {
    id: 'corsfix',
    host: 'proxy.corsfix.com',
    label: 'Corsfix proxy',
    category: 'proxy',
    probeUrl: 'https://proxy.corsfix.com/?https://example.com',
    openUrl: 'https://corsfix.com/',
    matters: 'The fastest CORS proxy tested, and it can carry API keys.',
  },
  {
    id: 'corsproxy-io',
    host: 'corsproxy.io',
    label: 'CorsProxy.io',
    category: 'proxy',
    probeUrl: 'https://corsproxy.io/?url=https%3A%2F%2Fexample.com',
    openUrl: 'https://corsproxy.io/',
    matters: 'A CORS proxy whose free tier only answers development origins.',
  },
  {
    id: 'dub',
    host: 'api.dub.co',
    label: 'Dub (shortener)',
    category: 'shortener',
    probeUrl: 'https://api.dub.co/',
    openUrl: 'https://dub.co',
    matters: 'Shortening links with Dub.',
  },
  {
    id: 'shortio',
    host: 'api.short.io',
    label: 'Short.io',
    category: 'shortener',
    probeUrl: 'https://api.short.io/',
    openUrl: 'https://short.io',
    matters: 'Shortening links with Short.io.',
  },
  {
    id: 'tly',
    host: 'api.t.ly',
    label: 'T.LY (shortener)',
    category: 'shortener',
    probeUrl: 'https://api.t.ly/',
    openUrl: 'https://t.ly',
    matters: 'Shortening links with T.LY.',
  },
  {
    id: 'isgd',
    host: 'is.gd',
    label: 'is.gd (shortener)',
    category: 'shortener',
    probeUrl: 'https://is.gd/',
    openUrl: 'https://is.gd',
    matters: 'Shortening links without an account.',
  },
  {
    id: 'control',
    host: 'example.com',
    label: 'Control',
    category: 'control',
    // The whole point of a control: a host nobody blocks on purpose. If this
    // one fails, the network or the browser is the problem and no individual
    // verdict below it means anything.
    probeUrl: 'https://example.com/',
    openUrl: 'https://example.com',
    matters: 'Nothing — this one is only here to prove the test itself works.',
  },
];

export const CATEGORY_LABELS: Record<ProbeCategory, string> = {
  core: 'Your server',
  connector: 'Connections',
  proxy: 'CORS proxies',
  shortener: 'Link shorteners',
  control: 'Control',
};

/** What the JS probe concluded. Never a cause — only what was observed. */
export type ProbeVerdict =
  /** Not run yet. */
  | 'idle'
  /** In flight. */
  | 'checking'
  /** The host answered. DNS, TCP and TLS all worked. */
  | 'reachable'
  /** The request failed. Blocked, offline, dead, or refused — indistinguishable. */
  | 'failed'
  /** The request ran out of time without an answer. */
  | 'timeout';

/**
 * Whether this origin may *read* the host's replies, as opposed to merely
 * reaching it.
 *
 * A distinct axis from {@link ProbeVerdict}, and keeping them apart is the
 * point: "the bytes never arrived" and "the bytes arrived but the browser will
 * not let me look at them" have completely different remedies, and only the
 * second is what a CORS proxy is for. `unknown` is the honest answer whenever
 * the host was never reached, since a CORS result would be meaningless there.
 */
export type CorsReadable = 'unknown' | 'readable' | 'blocked';

export interface ProbeResult {
  verdict: ProbeVerdict;
  cors: CorsReadable;
  /**
   * How long the reachability probe took, in milliseconds. Null before a run.
   *
   * Kept because the *shape* of a failure is itself evidence: a refusal comes
   * back in milliseconds, while a firewall silently discarding packets takes
   * seconds to give up. See {@link timingHint}.
   */
  ms: number | null;
}

/** What the user says the browser showed them in the new tab. */
export type ReportedOutcome =
  | 'loaded'
  /**
   * A Cloudflare "verify you are human" interstitial, or any equivalent bot
   * check. Deliberately its own outcome rather than a flavour of `loaded`:
   * the host is reachable and answering, so the *network* is exonerated, but
   * the connector still cannot work and will keep breaking after it appears to
   * be fixed. Neither "it loaded" nor "I was blocked" describes that.
   */
  | 'bot-check'
  | 'block-page'
  | 'cert-warning'
  | 'dns-error'
  | 'timed-out'
  | 'other';

export interface ReportedOption {
  value: ReportedOutcome;
  label: string;
}

/**
 * The self-report choices, worded as what a person actually sees rather than
 * as network terminology — nobody reads `ERR_NAME_NOT_RESOLVED` and thinks
 * "DNS failure".
 */
export const REPORTED_OPTIONS: readonly ReportedOption[] = [
  { value: 'loaded', label: 'The site loaded normally' },
  { value: 'bot-check', label: 'A “verify you are human” or CAPTCHA check' },
  { value: 'block-page', label: 'A block page from my network or workplace' },
  { value: 'cert-warning', label: 'A certificate or security warning' },
  { value: 'dns-error', label: "The browser couldn't find the server" },
  { value: 'timed-out', label: 'It spun and then gave up' },
  { value: 'other', label: 'Something else' },
];

/**
 * Combine the two halves into one sentence.
 *
 * This is the only place in the doctor that names a *likely cause*, and it can
 * only do so because the pairing carries information neither half has alone:
 * the classic result is a JS failure against a page that loads perfectly, which
 * rules the network out and points at CORS or an extension. Every string below
 * hedges, because none of this is provable from a web page.
 */
export function interpret(verdict: ProbeVerdict, reported: ReportedOutcome): string {
  const jsWorked = verdict === 'reachable';
  switch (reported) {
    case 'loaded':
      return jsWorked
        ? 'Both worked. This host is fine on this network.'
        : 'The page loads but the background request does not. That points at CORS, a browser extension or an ad blocker rather than a network block — the host itself is reachable from here.';
    case 'bot-check':
      return jsWorked
        ? 'The service is putting a bot check in front of its website, but the background request still went through — so this is about their front door, not about your connection. Nothing to do.'
        : 'Good news and bad news: your network is fine — the host answered, it just refused to trust the visitor. A bot check cannot be passed by a background request, because there is nobody there to click it, so the connector will keep failing even after you clear the challenge in that tab. This is the service deciding it does not want browser traffic it cannot identify. A CORS proxy sometimes gets past it, and often gets the same check pointed at the proxy instead.';
    case 'block-page':
      return 'Your network or workplace is filtering this host on purpose. Nothing in the app can work around that; it needs to be allowed by whoever runs the network.';
    case 'cert-warning':
      return 'Something is intercepting the connection — usually corporate TLS inspection, sometimes a captive portal. Background requests fail even when you can click through the warning, because scripts get no such choice.';
    case 'dns-error':
      return 'The name does not resolve here. That is typically DNS-level filtering, though it also looks like this when a host has genuinely gone away.';
    case 'timed-out':
      return 'The connection is being dropped rather than refused, which usually means a firewall is discarding the traffic silently. A slow or overloaded host looks the same from here.';
    case 'other':
      return jsWorked
        ? 'The background request succeeded, so the host is reachable — whatever the tab showed is about that page, not about connectivity.'
        : 'The background request failed too. Worth a second run: if the control row at the bottom also failed, the problem is the whole network rather than this host.';
  }
}

/**
 * What the *duration* of a failure suggests, for the cases in between.
 *
 * How long a request takes to fail is one of the few extra signals a browser
 * still gets, because the timing is a property of the connection attempt rather
 * than of the response, and so escapes the cross-origin blackout. The shapes
 * are genuinely distinguishable:
 *
 * - **Instant failure (under ~20ms)**: nothing was ever sent over the network.
 *   A DNS answer already cached as NXDOMAIN, or — most often on a managed
 *   machine — an extension or policy cancelling the request before it leaves
 *   the browser.
 * - **Roughly one round trip (~20ms to 1.5s)**: it reached something, which
 *   refused it. A host declining browser traffic and a filtering proxy that
 *   answers rather than drops both look like this.
 * - **Slow failure short of the timeout**: something along the path deliberated
 *   before giving up, which is more typical of a filter than of a dead host.
 * - **Ran to the timeout**: nothing answered at all. Silent packet discard,
 *   which is what most corporate firewalls do to a host on a blocklist.
 *
 * The cutoffs are measured rather than guessed — real refusals from nearby
 * hosts came back in 50-350ms, so an earlier 100ms "this must be local"
 * threshold was misreading ordinary refusals as extension blocks.
 *
 * Returns null when the timing adds nothing to what the verdict already says —
 * a hint on every row would be noise, and noise is how a diagnostic stops being
 * read.
 */
export function timingHint(result: ProbeResult): string | null {
  const { verdict, ms } = result;
  if (ms === null) {
    return null;
  }
  if (verdict === 'timeout') {
    return 'Nothing answered before the deadline. Traffic to this host is most likely being discarded silently rather than refused — the usual signature of a firewall blocklist.';
  }
  if (verdict !== 'failed') {
    // A slow success is worth flagging: it works, but it is the kind of slow
    // that makes a feature feel broken, and AllOrigins is exactly this.
    return ms >= 5000
      ? `Reachable, but slow — ${formatMs(ms)}. Features using this host will feel sluggish even though nothing is blocked.`
      : null;
  }
  // Thresholds measured against real hosts rather than guessed: a genuine
  // round trip to a nearby server lands around 50-350ms, so the earlier
  // "instant means local" cutoff of 100ms was calling ordinary refusals
  // extension blocks. Only single-digit milliseconds is fast enough to prove
  // nothing went out on the wire.
  if (ms < 20) {
    return `Failed instantly (${formatMs(ms)}) — too fast for anything to have gone out over the network. That points at something inside the browser: an extension, an ad blocker, or a DNS failure already cached.`;
  }
  if (ms < 1500) {
    return `Failed after ${formatMs(ms)}, which is about one round trip — so it reached something that refused it, rather than being ignored. A host declining browser traffic looks like this, as does a filter that answers rather than drops.`;
  }
  return `Failed after ${formatMs(ms)}, without running out the clock. Something along the path took its time before giving up, which is more typical of a filtering proxy than of a host that is simply down.`;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * What the CORS leg means, for a host already proven reachable.
 *
 * This is the answer to "which domains do I need to whitelist?" — and the
 * answer is that whitelisting is the wrong tool. A blocked reply is the *host*
 * choosing not to send `Access-Control-Allow-Origin`, so nothing installed on
 * this side changes their decision. An extension that strips CORS locally makes
 * this one page work while disabling a protection that applies to every site in
 * the browser, which is a genuinely bad trade for reading a timeline.
 *
 * Returns null when the host was never reached, where a CORS verdict would be
 * meaningless and stating one would invite exactly the wrong fix.
 */
export function corsHint(result: ProbeResult): string | null {
  if (result.verdict !== 'reachable') {
    return null;
  }
  if (result.cors === 'readable') {
    return 'This app can read its replies directly — no proxy needed.';
  }
  if (result.cors === 'blocked') {
    return 'Reachable, but it refuses to let this app read the reply: the host does not send the header that would permit it. That is their policy, not a fault on your network, and not something a browser setting can grant you. Mawkingbird routes these through a CORS proxy instead.';
  }
  return null;
}
