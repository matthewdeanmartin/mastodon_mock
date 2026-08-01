/**
 * The catalog of CORS proxies the RSS reader (and, later, article extraction)
 * can fall back to when a source refuses browser access.
 *
 * Like `connection-catalog.ts` this is deliberately inert data: enough to
 * choose a proxy, nothing about how the choice is stored or used. The one
 * addition is {@link CorsProxyEntry.template}, which *is* behaviour — but it is
 * the same kind of fact as the label (it is how the service spells its own API),
 * and keeping it here is what makes adding a proxy a one-entry change.
 *
 * ## Why this exists at all
 *
 * A proxy is a machine-in-the-middle by construction. It sees every URL it is
 * asked for and every byte that comes back, and it can lie about both. That is
 * an acceptable trade for a *public* RSS feed — the content is public anyway,
 * and the alternative is not reading it — and it is never acceptable for
 * anything carrying a credential. {@link buildProxiedUrl} enforces that in code
 * rather than trusting callers; see `cors-proxy.ts`.
 *
 * ## Why so few of them work
 *
 * Public CORS proxies churn constantly. CorsProxy.io's free tier is restricted
 * to localhost and other development origins: genuinely useful under `ng serve`
 * and unable to work at all from the deployed origin. It is marked
 * {@link CorsProxyEntry.devOnly} and filtered out of the picker on a deployed
 * build, because offering a choice that is guaranteed to fail is worse than not
 * offering it.
 *
 * Several widely-recommended proxies are absent entirely because they were
 * tested and do not work — see the comment among the entries below. Recording
 * the negative results is the point: they are the first hits when anyone
 * searches for a free CORS proxy.
 *
 * ## Two axes, not one
 *
 * "Does this proxy work?" turns out to be two independent questions, and the
 * second one is invisible until an authenticated API is involved:
 *
 * 1. **Will it answer my origin at all?** — {@link CorsProxyEntry.devOnly} and
 *    {@link CorsProxyEntry.originAllowlist}.
 * 2. **Will it forward my request headers?** —
 *    {@link CorsProxyEntry.forwardsCustomHeaders}. A proxy that drops them can
 *    fetch any public RSS feed perfectly while making every key-authenticated
 *    API look like it rejected the user's key.
 *
 * AllOrigins is the cautionary case: no signup, works from a deployed origin,
 * and completely unable to carry an API key. Corsfix is the opposite — it was
 * previously marked `devOnly` and hidden in production, when in fact its free
 * tier is *allowlist*-based (localhost implicitly, other domains once
 * registered) and it is the fastest option tested.
 */

/** Route-free identity of a proxy, and the value persisted in settings. */
export type CorsProxyId = 'allorigins' | 'corssh' | 'corsfix' | 'corsproxy-io' | 'custom';

/** How a proxy wants the target URL spliced into its own. */
export interface CorsProxyTemplate {
  /**
   * The proxy URL with `{url}` standing in for the target.
   *
   * Empty for `custom`, whose template the user supplies.
   */
  pattern: string;
  /**
   * Whether `{url}` is percent-encoded before substitution.
   *
   * Both forms are in the wild and they are not interchangeable: a proxy that
   * reads the target from a query parameter needs it encoded or the target's
   * own `?a=1&b=2` is parsed as the *proxy's* parameters, while a proxy that
   * takes the target as a path suffix needs it raw.
   */
  encodeTarget: boolean;
}

export interface CorsProxyEntry {
  id: CorsProxyId;
  /** Display name, as the service spells it. */
  label: string;
  /** One sentence: what this service is and who it is for. */
  pitch: string;
  template: CorsProxyTemplate;
  /**
   * The header this proxy authenticates with, when it has one.
   *
   * Only the header *name* is catalog data; the value is the user's secret and
   * lives in {@link CorsProxySettings}. A proxy with a name here shows a key
   * field in the UI.
   */
  keyHeader?: string;
  /** Whether the proxy refuses to work without a key. */
  keyRequired?: boolean;
  /** What the key costs, for the UI to set expectations honestly. */
  keyNote?: string;
  /**
   * True when the free tier only accepts requests from localhost and similar
   * development origins. Hidden from the picker on a deployed build.
   */
  devOnly?: boolean;
  /**
   * Whether this proxy forwards non-safelisted request headers to the target.
   *
   * The property that decides whether an *authenticated* API is reachable at
   * all, and it is invisible from the outside until you test it. A proxy that
   * drops `X-API-Key` does not fail loudly: the target simply answers "no key
   * supplied", which reads like the user pasted the wrong key. Recording it
   * here turns a confusing dead end into a filtered picker.
   *
   * Measured, not assumed — see `sprint/twitter-1-transport.md`:
   *  - AllOrigins: `false`. Its preflight allows only `Origin,
   *    X-Requested-With, Content-Type, Content-Encoding, Accept`.
   *  - CORS.SH and Corsfix: `true`, both verified end to end against a real
   *    key-requiring API.
   *
   * `undefined` means unproven — the honest state for a proxy nobody has tested
   * this way, including `custom`, whose behaviour depends on what the user
   * deployed. Unproven is offered but labelled, never silently trusted.
   */
  forwardsCustomHeaders?: boolean;
  /**
   * How the proxy authorizes the *calling site* rather than the request.
   *
   * Corsfix is the case this exists for: it has no per-request key on the free
   * tier, it has an allowlist of registered domains. Its refusal
   * (`domain_not_registered`) is a setup step, not a fault, and the connector
   * page needs to say so instead of reporting a generic 403.
   */
  originAllowlist?: {
    /** Where the user registers their domain. */
    dashboardUrl: string;
    /** Shown when the proxy rejects this origin. */
    note: string;
  };
  /** Published limits, or the most reliable report of them. Shown as-is. */
  limits: string;
  /** The service's own page, for the user to verify any of the above. */
  homepage: string;
}

/**
 * Every proxy, in the order they appear.
 *
 * Ordered by how likely they are to actually work for the person reading the
 * list: the no-signup option first (fine for RSS, which is most people's use),
 * then the two that carry API keys once configured, then the development-only
 * one, then custom. Custom is last but is the one the copy steers anybody
 * serious toward.
 */
export const CORS_PROXY_CATALOG: readonly CorsProxyEntry[] = [
  {
    id: 'allorigins',
    label: 'AllOrigins',
    pitch: 'Free and open, no signup. The only free option that works from a deployed site.',
    template: {
      pattern: 'https://api.allorigins.win/raw?url={url}',
      encodeTarget: true,
    },
    // Measured 2026-07-31: drops custom request headers, so any API needing a
    // key header is unreachable through it. Also ~26s for a call that takes
    // ~1s through CORS.SH. Fine for public RSS, useless for authenticated APIs.
    forwardsCustomHeaders: false,
    limits:
      'Roughly 20 requests per minute, and frequently slow (26s in testing). No uptime guarantee. Cannot send API keys — it strips custom headers.',
    homepage: 'https://allorigins.win/',
  },
  {
    id: 'corssh',
    label: 'CORS.SH',
    pitch: 'A cors-anywhere replacement. Works from any origin once you bring a key.',
    template: {
      pattern: 'https://proxy.cors.sh/{url}',
      encodeTarget: false,
    },
    keyHeader: 'x-cors-api-key',
    keyRequired: true,
    keyNote: 'Free keys are available from the CORS.SH site; paid plans lift the limits.',
    // Measured 2026-07-31: forwarded X-API-Key to an authenticated API from a
    // deployed origin, ~1.3-1.8s, preflight answered
    // `access-control-allow-headers: x-api-key`.
    forwardsCustomHeaders: true,
    limits: 'Depends on your plan. The free key is rate-limited.',
    homepage: 'https://cors.sh/',
  },
  {
    id: 'corsfix',
    label: 'Corsfix',
    pitch: 'The fastest option tested, and it can carry API keys. Register your domain first.',
    template: {
      pattern: 'https://proxy.corsfix.com/?{url}',
      encodeTarget: false,
    },
    // Measured 2026-07-31: forwarded X-API-Key and returned real data in 0.77s
    // — the fastest of everything tested. Preflight answered
    // `Access-Control-Allow-Headers: x-api-key`.
    forwardsCustomHeaders: true,
    // NOT devOnly. The earlier `devOnly: true` was wrong: the free tier is not
    // localhost-*only*, it is allowlist-based. localhost is simply allowed
    // implicitly, while any other origin must be registered. A deployed site
    // whose domain is registered works fine, so hiding this in production was
    // hiding the best free option there is.
    originAllowlist: {
      dashboardUrl: 'https://corsfix.com/dashboard',
      note: 'Corsfix answers localhost automatically. For a deployed site, add your domain in the Corsfix dashboard first — until you do it replies "domain_not_registered" (HTTP 403), which is a setup step, not a fault.',
    },
    keyHeader: 'x-corsfix-key',
    keyNote:
      'Optional. Domain registration is the usual route; a key is only needed if you would rather not allowlist an origin.',
    limits: '60 requests per minute on the free tier. 5 MB payload cap, 20s upstream timeout.',
    homepage: 'https://corsfix.com/',
  },
  {
    id: 'corsproxy-io',
    label: 'CorsProxy.io',
    pitch: 'Edge-hosted and quick, but the free tier only answers development origins.',
    template: {
      pattern: 'https://corsproxy.io/?url={url}',
      encodeTarget: true,
    },
    keyHeader: 'x-cors-api-key',
    keyNote: 'A key lifts it beyond localhost; there is a free account tier.',
    devOnly: true,
    limits: 'Free tier is localhost-only, with a 1 MB response cap.',
    homepage: 'https://corsproxy.io/',
  },
  // Proxies deliberately NOT listed, having been tested and found unusable
  // (2026-07-31). Recorded here so the next person to find them on a
  // "free CORS proxies" list does not spend the afternoon re-discovering this:
  //
  // - **WhateverOrigin** (whateverorigin.org). Defunct. `/get?url=…` returns the
  //   service's own marketing homepage as HTML for every target, including
  //   `https://example.com`. Not a header problem — it no longer proxies at all.
  //
  // - **cors.lol**. Answered HTTP 429 "Rate limit exceeded" on essentially every
  //   request from a residential IP, including the very first of a session and a
  //   trivial `example.com` target. It briefly served `example.com` once and
  //   then 429'd everything after, so its header-forwarding could not even be
  //   established. A proxy that rate-limits below one request per session cannot
  //   be offered to users.
  //
  // - **CORS Anywhere** (cors-anywhere.herokuapp.com). HTTP 403 "See /corsdemo
  //   for more info": the public demo requires a human to click through an
  //   activation page, and that grant is temporary. Self-hosting it is a real
  //   option, but that is the `custom` entry below, not a distinct service.
  {
    id: 'custom',
    label: 'Your own proxy',
    pitch:
      'A CORS proxy you run and trust — a Cloudflare Worker, self-hosted CORS Anywhere, or a paid service. The only option nobody else can rate-limit or shut down.',
    template: { pattern: '', encodeTarget: true },
    keyHeader: '',
    keyNote: 'Optional. Set a header name and value if your proxy needs one.',
    // Deliberately left `undefined` rather than `true`. Whether a self-hosted
    // proxy forwards headers depends entirely on what the user deployed — a
    // stock CORS Anywhere does, a hand-rolled Worker that rebuilds the request
    // may not. Claiming `true` here would be guessing on the user's behalf
    // about the one property that silently breaks authenticated APIs.
    limits: 'Whatever you configure.',
    homepage: 'https://developers.cloudflare.com/workers/',
  },
];

/**
 * Proxies that can carry a request needing a custom header, such as an API key.
 *
 * `undefined` (unproven) is included rather than filtered: a self-hosted proxy
 * usually does forward headers, and excluding `custom` would remove the one
 * option nobody can rate-limit. The caller shows unproven entries with a
 * "not verified" note and lets the connector's Test button settle it.
 *
 * Only a measured `false` is excluded — currently AllOrigins, where the key
 * would be dropped and the target's "no key supplied" reply would look like the
 * user's key was wrong.
 */
export function headerCapableCorsProxies(
  hostname: string = location.hostname,
): readonly CorsProxyEntry[] {
  return availableCorsProxies(hostname).filter((entry) => entry.forwardsCustomHeaders !== false);
}

export function corsProxyEntry(id: CorsProxyId): CorsProxyEntry | undefined {
  return CORS_PROXY_CATALOG.find((entry) => entry.id === id);
}

/**
 * Whether this build is running somewhere a dev-only proxy would accept.
 *
 * Deliberately generous about what counts as local — the cost of a false
 * positive is one clear error message from the proxy, while a false negative
 * hides a working option from a developer.
 */
export function isDevelopmentOrigin(hostname: string = location.hostname): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  );
}

/** The proxies worth showing here: everything, minus dev-only ones in production. */
export function availableCorsProxies(
  hostname: string = location.hostname,
): readonly CorsProxyEntry[] {
  const local = isDevelopmentOrigin(hostname);
  return CORS_PROXY_CATALOG.filter((entry) => local || !entry.devOnly);
}
