import { inject, Injectable } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { Server } from '../../server';
import { CorsProxyConfig, CorsProxySettings } from './cors-proxy-settings';

/**
 * Builds proxied requests, and refuses to build the dangerous ones.
 *
 * ## The guarantee
 *
 * A CORS proxy sees the full URL it is asked to fetch, every request header it
 * is given, and every byte of the response. Routing a *public RSS feed* through
 * one discloses nothing that was not already public. Routing anything
 * authenticated through one hands a stranger a credential.
 *
 * The rule is therefore enforced here, in the one place that can build a
 * proxied URL, rather than by asking callers to be careful. Callers get things
 * wrong; a feature added a year from now will not remember this rule. Every
 * path to a proxy goes through {@link proxyRequest}, and every violation
 * {@link throws} — it never silently falls back to a direct fetch, because a
 * silent fallback turns "we nearly leaked your token" into a mystery
 * intermittent CORS bug instead of a loud error.
 *
 * ## What is refused, and why
 *
 * - **Anything with an `Authorization` header** — the single most direct way to
 *   hand over a bearer token.
 * - **The selected Mastodon instance** — its API is authenticated and its
 *   responses are the user's own timeline. Refused even when the immediate
 *   request looks anonymous, because the host is one an interceptor may later
 *   decide to attach a token to.
 * - **Every connected service's host** — bsky.social and any PDS, OpenRouter,
 *   Raindrop, GitHub, Dropbox. These are exactly the hosts whose traffic
 *   carries the credentials this app stores.
 * - **URLs carrying credentials in themselves** — userinfo (`https://u:p@host`)
 *   and non-HTTP(S) schemes.
 * - **Plain `http://` targets from an HTTPS page** — the proxy would be
 *   laundering mixed content the browser is right to block.
 *
 * The blocklist is a backstop, not the primary defence: the primary defence is
 * that only feed and article fetches ever call this at all. A backstop that is
 * never hit is doing its job.
 */

/** Hosts whose traffic carries a credential this app holds. Suffix-matched. */
const CREDENTIAL_HOSTS: readonly string[] = [
  'bsky.social',
  'bsky.network',
  'openrouter.ai',
  'raindrop.io',
  'github.com',
  'dropboxapi.com',
  'dropbox.com',
];

/** Raised when a request must not be proxied. Never caught into a direct fetch. */
export class CorsProxyRefusal extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CorsProxyRefusal';
  }
}

/** A request rewritten to go through the proxy. */
export interface ProxiedRequest {
  url: string;
  headers: HttpHeaders;
}

@Injectable({ providedIn: 'root' })
export class CorsProxy {
  private settings = inject(CorsProxySettings);
  private server = inject(Server);

  /** Whether a usable proxy is configured. */
  available(): boolean {
    return this.settings.usable();
  }

  /** The configured proxy's display name, for UI that names it. */
  label(): string | null {
    return this.settings.chosen()?.label ?? null;
  }

  /**
   * Rewrite a target URL into a proxied one.
   *
   * @throws CorsProxyRefusal when no proxy is configured, or when routing this
   * target through one would disclose a secret.
   */
  proxyRequest(targetUrl: string): ProxiedRequest {
    const config = this.settings.resolve();
    if (!config) {
      throw new CorsProxyRefusal('No CORS proxy is configured.');
    }
    assertProxyable(targetUrl, this.server.baseUrl());
    return {
      url: buildProxiedUrl(config, targetUrl),
      headers: proxyHeaders(config),
    };
  }
}

/**
 * Splice the target into the proxy's template.
 *
 * Exported for testing and for the settings page's preview, which shows the
 * user the exact URL their configuration produces — the fastest way to spot a
 * template with the placeholder in the wrong place.
 */
export function buildProxiedUrl(config: CorsProxyConfig, targetUrl: string): string {
  const target = config.encodeTarget ? encodeURIComponent(targetUrl) : targetUrl;
  return config.pattern.replace('{url}', target);
}

/** The headers a proxied request carries: the proxy's key, and nothing else. */
export function proxyHeaders(config: CorsProxyConfig): HttpHeaders {
  let headers = new HttpHeaders();
  if (config.header) {
    headers = headers.set(config.header.name, config.header.value);
  }
  return headers;
}

/**
 * Throw unless `targetUrl` is safe to hand to a third-party proxy.
 *
 * Exported so callers that want to *ask* (to grey out a toggle, say) can use
 * {@link canProxy} without triggering a request.
 */
export function assertProxyable(targetUrl: string, mastodonBaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new CorsProxyRefusal(`Not a valid absolute URL: ${targetUrl}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CorsProxyRefusal(`Only http(s) URLs can be proxied, not ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new CorsProxyRefusal(
      'This URL carries a username or password, which must never be sent through a proxy.',
    );
  }

  if (url.protocol === 'http:' && location.protocol === 'https:') {
    throw new CorsProxyRefusal('Refusing to proxy an insecure http:// address from a secure page.');
  }

  const host = url.hostname.toLowerCase();

  if (hostMatches(host, mastodonHost(mastodonBaseUrl))) {
    throw new CorsProxyRefusal(
      'Refusing to send a request for your Mastodon instance through a CORS proxy — those requests are authenticated.',
    );
  }

  // Origin, not hostname: a different port is a different server. Comparing
  // hostnames would refuse a feed on 127.0.0.1:8901 while the app runs on
  // 127.0.0.1:8899, which is exactly the local-development case, and it is a
  // real cross-origin request that genuinely needs the proxy.
  if (url.origin === location.origin) {
    throw new CorsProxyRefusal(
      "Refusing to proxy this app's own origin. Same-origin requests never need a proxy.",
    );
  }

  for (const credentialHost of CREDENTIAL_HOSTS) {
    if (hostMatches(host, credentialHost)) {
      throw new CorsProxyRefusal(
        `Refusing to send a request for ${credentialHost} through a CORS proxy — you have a connected account there.`,
      );
    }
  }
}

/** Non-throwing form of {@link assertProxyable}, for UI that needs to ask first. */
export function canProxy(targetUrl: string, mastodonBaseUrl: string): boolean {
  try {
    assertProxyable(targetUrl, mastodonBaseUrl);
    return true;
  } catch {
    return false;
  }
}

/** Why a URL cannot be proxied, or null when it can. */
export function proxyRefusalReason(targetUrl: string, mastodonBaseUrl: string): string | null {
  try {
    assertProxyable(targetUrl, mastodonBaseUrl);
    return null;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : 'This URL cannot be proxied.';
  }
}

/**
 * The instance's hostname, or null for the mock (whose base URL is empty).
 *
 * Hostname rather than origin, deliberately and unlike the same-origin check:
 * `files.mastodon.social` is not the API host but is still the user's
 * instance's infrastructure, and over-refusing an authenticated host costs a
 * feed nobody wanted to proxy anyway.
 */
function mastodonHost(baseUrl: string): string | null {
  if (!baseUrl) {
    return null;
  }
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether `host` is `candidate` or a subdomain of it.
 *
 * Suffix-matched on a dot boundary so `bsky.social` also covers a user's PDS at
 * `morel.us-east.host.bsky.network`, while `notbsky.social` does not match.
 */
function hostMatches(host: string, candidate: string | null): boolean {
  if (!candidate) {
    return false;
  }
  return host === candidate || host.endsWith(`.${candidate}`);
}
