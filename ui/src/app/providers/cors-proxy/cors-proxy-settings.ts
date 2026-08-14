import { computed, inject, Injectable, signal } from '@angular/core';
import {
  credentialExpired,
  credentialExpiresAt,
  ensureStamped,
  ExpiringConnection,
  ExpiringCredential,
  stampCredential,
} from '../credential-lifetime';
import {
  availableCorsProxies,
  CorsProxyEntry,
  CorsProxyId,
  corsProxyEntry,
} from './cors-proxy-catalog';
import { FeatureFlagId, FeatureFlags, proxyFeatureFlag } from '../../feature-flags';

/**
 * Which CORS proxy this browser uses, and the key for it.
 *
 * ## Storage shape
 *
 * Two keys, split on sensitivity, the same way `mockingbird_bsky_credentials`
 * is split from `mockingbird_bsky_profile`:
 *
 * - `mockingbird_cors_proxy` — the chosen id and any custom URL template.
 *   Public-ish configuration, exportable.
 * - `mockingbird_cors_proxy_key` — the API key and custom header name. A
 *   secret, never exported, and subject to the credential retention policy.
 *
 * ## Why the key is not account-scoped
 *
 * Same reasoning as {@link OpenRouterSession}: a proxy subscription belongs to
 * the *human* paying for it, not to a Mastodon persona. It is the same key
 * whichever account you are signed in as, and making you re-paste it per alt
 * would be busywork protecting nothing — the alt can read the other copy out of
 * the same localStorage regardless. Registered `suffix: 'none'`.
 *
 * ## Why the key expires
 *
 * A paid proxy key is a billable credential: whoever reads it out of this
 * origin's localStorage can spend the owner's quota. That puts it in exactly
 * the same class as the GitHub and Raindrop tokens, so it carries a
 * `connectedAt` stamp and this service implements {@link ExpiringConnection}.
 * The *choice* of proxy is not a secret and survives the key ageing out — the
 * user re-pastes a key rather than reconfiguring from scratch.
 */

const CONFIG_KEY = 'mockingbird_cors_proxy';
const SECRET_KEY = 'mockingbird_cors_proxy_key';

/** The non-secret half: which proxy, and how to reach it if it is a custom one. */
interface StoredCorsProxyConfig {
  id: CorsProxyId;
  /** For `custom` only: the URL template, with `{url}` where the target goes. */
  customTemplate?: string;
  /** For `custom` only: whether to percent-encode the target. */
  customEncodeTarget?: boolean;
}

/** The secret half. Absent when the chosen proxy needs no key. */
interface StoredCorsProxyKey extends ExpiringCredential {
  /** The header value — the actual secret. */
  key: string;
  /** For `custom` only: the header name the user's proxy expects. */
  customHeader?: string;
}

/** Everything a request builder needs, resolved from both halves. */
export interface CorsProxyConfig {
  entry: CorsProxyEntry;
  /** The template to use — the catalog's, or the user's for `custom`. */
  pattern: string;
  encodeTarget: boolean;
  /** Header name and value, or null when the proxy is used unauthenticated. */
  header: { name: string; value: string } | null;
}

@Injectable({ providedIn: 'root' })
export class CorsProxySettings implements ExpiringConnection {
  // `optional` because this service is constructed directly (`new
  // CorsProxySettings()`) in a few specs and utilities, outside any injector.
  // A missing FeatureFlags there must not throw NG0203; it means "no flag
  // service available", and the fallback below treats every proxy as offered,
  // which is the pre-flag behaviour those callers already expect.
  private flags = inject(FeatureFlags, { optional: true });
  private config = signal<StoredCorsProxyConfig | null>(readConfig());
  private secret = signal<StoredCorsProxyKey | null>(readSecret());

  /** Whether a proxy id is switched on, tolerating a missing flag service. */
  private proxyFlagEnabled = (flagId: string): boolean =>
    this.flags?.enabled(flagId as FeatureFlagId) ?? true;

  /**
   * The chosen proxy, or null when the user has not picked one — or when the one
   * they picked is switched off by a feature flag.
   *
   * The flag is enforced *here*, on the read every consumer goes through, rather
   * than only in the picker. A selection stored before the flag was turned off
   * would otherwise keep relaying traffic through a proxy the app no longer
   * offers, which is the opposite of what turning it off means. Everything
   * downstream — `usable`, `resolve()`, and so every proxied request in the app —
   * inherits the check from this one computed.
   */
  readonly chosen = computed<CorsProxyEntry | null>(() => {
    const id = this.config()?.id;
    const entry = id ? (corsProxyEntry(id) ?? null) : null;
    if (!entry) {
      return null;
    }
    const flag = proxyFeatureFlag(entry.id);
    return flag === null || this.proxyFlagEnabled(flag) ? entry : null;
  });

  /** Whether a proxy is configured well enough to actually be used. */
  readonly usable = computed(() => this.resolve() !== null);

  /** True when a key is stored, without exposing it. */
  readonly hasKey = computed(() => (this.secret()?.key ?? '') !== '');

  constructor() {
    this.enforceLifetime();
  }

  /** The chosen id, for the settings UI to render its picker against. */
  currentId(): CorsProxyId | null {
    return this.config()?.id ?? null;
  }

  /** The stored custom template, for the settings form to prefill. */
  customTemplate(): string {
    return this.config()?.customTemplate ?? '';
  }

  /** The stored custom header name, for the settings form to prefill. */
  customHeader(): string {
    return this.secret()?.customHeader ?? '';
  }

  customEncodeTarget(): boolean {
    return this.config()?.customEncodeTarget ?? true;
  }

  /**
   * Everything needed to build a proxied request, or null when the current
   * configuration cannot make one.
   *
   * Returns null — rather than a half-built config — when a proxy that requires
   * a key has none, or a custom proxy has no usable template. The caller then
   * treats the proxy as unconfigured, which is the safe direction: no proxy
   * means a direct fetch that fails visibly, not a malformed request to a
   * half-configured third party.
   */
  resolve(): CorsProxyConfig | null {
    const entry = this.chosen();
    if (!entry) {
      return null;
    }
    const stored = this.config();
    const key = this.secret()?.key ?? '';

    const pattern = entry.id === 'custom' ? (stored?.customTemplate ?? '') : entry.template.pattern;
    if (!pattern.includes('{url}')) {
      return null;
    }
    const encodeTarget =
      entry.id === 'custom' ? (stored?.customEncodeTarget ?? true) : entry.template.encodeTarget;

    if (entry.keyRequired && !key) {
      return null;
    }

    const headerName = entry.id === 'custom' ? this.customHeader() : (entry.keyHeader ?? '');
    const header = headerName && key ? { name: headerName, value: key } : null;

    return { entry, pattern, encodeTarget, header };
  }

  /** Choose a proxy. Selecting a different one leaves any stored key in place. */
  select(id: CorsProxyId, options?: { template?: string; encodeTarget?: boolean }): void {
    const next: StoredCorsProxyConfig = { id };
    if (id === 'custom') {
      next.customTemplate = options?.template?.trim() ?? this.customTemplate();
      next.customEncodeTarget = options?.encodeTarget ?? this.customEncodeTarget();
    }
    this.writeConfig(next);
  }

  /** Stop using any proxy. Also clears the key: nothing is left to leak. */
  clear(): void {
    remove(CONFIG_KEY);
    this.config.set(null);
    this.clearKey();
  }

  /**
   * Store an API key for the chosen proxy, stamped for the retention policy.
   *
   * An empty key clears the stored one rather than persisting a blank, so the
   * key field doubles as the way to remove a key you no longer want here.
   */
  setKey(key: string, customHeader?: string): void {
    const trimmed = key.trim();
    if (!trimmed) {
      this.clearKey();
      return;
    }
    const value: StoredCorsProxyKey = stampCredential({
      key: trimmed,
      ...(customHeader?.trim() ? { customHeader: customHeader.trim() } : {}),
    });
    try {
      localStorage.setItem(SECRET_KEY, JSON.stringify(value));
    } catch {
      // Storage full or blocked: honour the key for this session anyway.
    }
    this.secret.set(value);
  }

  clearKey(): void {
    remove(SECRET_KEY);
    this.secret.set(null);
  }

  /** {@link ExpiringConnection}: drop the key when it outlives the policy. */
  enforceLifetime(): void {
    const stored = this.secret();
    if (stored && credentialExpired(stored.connectedAt)) {
      this.clearKey();
    }
  }

  /** {@link ExpiringConnection}: when the key ages out, or null. */
  expiresAt(): number | null {
    return credentialExpiresAt(this.secret()?.connectedAt);
  }

  /**
   * Drop a selection that cannot work here.
   *
   * Called when the picker loads on a deployed build: a dev-only proxy chosen
   * under `ng serve` would otherwise stay selected in production and fail every
   * request with a CORS error that looks like the *feed's* fault.
   */
  dropUnavailableSelection(hostname: string = location.hostname): boolean {
    const id = this.currentId();
    if (!id) {
      return false;
    }
    // Also drops a proxy whose feature flag has since been turned off — the flag
    // is the same "is this offered at all" question, so a selection made before
    // it was switched off must not survive as a silently-active relay.
    const stillOffered = availableCorsProxies(hostname, this.proxyFlagEnabled).some(
      (entry) => entry.id === id,
    );
    if (stillOffered) {
      return false;
    }
    this.clear();
    return true;
  }

  private writeConfig(next: StoredCorsProxyConfig): void {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    } catch {
      // Non-persistent, but honour it for this session.
    }
    this.config.set(next);
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Unreadable and unremovable is still "not configured" in memory.
  }
}

function readConfig(): StoredCorsProxyConfig | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(CONFIG_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredCorsProxyConfig;
    // An id we no longer ship (a proxy that shut down, a renamed entry) is
    // discarded rather than kept as a dangling selection.
    return corsProxyEntry(parsed?.id) ? parsed : null;
  } catch {
    remove(CONFIG_KEY);
    return null;
  }
}

function readSecret(): StoredCorsProxyKey | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SECRET_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredCorsProxyKey;
    if (typeof parsed?.key !== 'string' || !parsed.key) {
      throw new Error('malformed');
    }
    return ensureStamped(SECRET_KEY, parsed);
  } catch {
    remove(SECRET_KEY);
    return null;
  }
}
