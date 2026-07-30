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
 * Public CORS proxies churn constantly. As of mid-2026 the free tiers of both
 * Corsfix and CorsProxy.io are restricted to localhost and other development
 * origins: they are genuinely useful under `ng serve` and cannot work at all
 * from the deployed origin. They are marked {@link CorsProxyEntry.devOnly} and
 * are filtered out of the picker on a deployed build, because offering a choice
 * that is guaranteed to fail is worse than not offering it.
 *
 * That leaves exactly one no-signup option that works in production
 * (AllOrigins, rate-limited and often slow), which is why "bring your own" is a
 * first-class entry here rather than an escape hatch. A paid key or a
 * self-hosted Worker is the only configuration that is actually dependable.
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
  /** Published limits, or the most reliable report of them. Shown as-is. */
  limits: string;
  /** The service's own page, for the user to verify any of the above. */
  homepage: string;
}

/**
 * Every proxy, in the order they appear.
 *
 * Ordered by how likely they are to actually work for the person reading the
 * list: the one free option that works in production, then the two that work
 * anywhere with a key, then the two development-only ones, then custom.
 * Custom is last but is the one the copy steers anybody serious toward.
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
    limits: 'Roughly 20 requests per minute, and frequently slow. No uptime guarantee.',
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
    limits: 'Depends on your plan. The free key is rate-limited.',
    homepage: 'https://cors.sh/',
  },
  {
    id: 'corsfix',
    label: 'Corsfix',
    pitch: 'Fast and well-maintained, but the free tier only answers localhost.',
    template: {
      pattern: 'https://proxy.corsfix.com/?{url}',
      encodeTarget: false,
    },
    devOnly: true,
    limits: '60 requests per minute on the free tier. Production origins need a paid plan.',
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
  {
    id: 'custom',
    label: 'Your own proxy',
    pitch:
      'A CORS proxy you run and trust — a Cloudflare Worker, self-hosted CORS Anywhere, or a paid service. The only option nobody else can rate-limit or shut down.',
    template: { pattern: '', encodeTarget: true },
    keyHeader: '',
    keyNote: 'Optional. Set a header name and value if your proxy needs one.',
    limits: 'Whatever you configure.',
    homepage: 'https://developers.cloudflare.com/workers/',
  },
];

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
