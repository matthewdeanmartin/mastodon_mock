import { Injectable, signal } from '@angular/core';
import { CorsProxyId } from '../cors-proxy/cors-proxy-catalog';
import { ShortenerId } from './shortener-provider';

/**
 * Records that the user knowingly agreed to send a shortener request through a
 * named CORS proxy. The request may carry a key, or only the destination URL.
 *
 * ## Why consent has to be stored at all
 *
 * `cors-proxy.ts` refuses, by design, to proxy anything carrying a credential,
 * and the shortener API hosts are on its blocklist. That refusal is right: a
 * proxy sees every header it is given, so routing `Authorization: Bearer …`
 * through a stranger's server hands them a working key.
 *
 * But these providers' APIs are built for server-to-server use and generally do
 * not answer browsers, so for many users a proxy is the only way the feature
 * works at all. The resolution is not to weaken the rule but to make the
 * exception explicit, narrow, and the user's own decision — which means it must
 * be *recorded*, or the app is either asking on every single request (so the
 * user clicks through without reading, which is worse than not asking) or
 * deciding silently on their behalf.
 *
 * ## What a consent is scoped to
 *
 * A `(shortener, proxy)` pair, both halves load-bearing:
 *
 * - Changing proxy means a *different company* now sees the key. The earlier
 *   answer said nothing about this one, so it is asked again.
 * - Changing shortener means a different key with different powers is at stake.
 *   Someone may well accept the risk for a throwaway T.LY token and refuse it
 *   for a Short.io key that owns their branded domain.
 *
 * Consent is also not permanent: it carries the moment it was granted, and the
 * connector page shows it and can revoke it. It is stored unscoped (browser-wide
 * rather than per Mastodon account) to match where the shortener key itself
 * lives — see {@link ShortenerSettings}.
 *
 * ## The self-hosted case
 *
 * A `custom` proxy is one the user runs. Their own server seeing their own key
 * is not a disclosure, so that case is still recorded (the app should not guess
 * at intent) but the UI asks with a plain note rather than a warning. Dressing
 * up "your key goes to your own server" in red text teaches people to dismiss
 * red text.
 */

const STORAGE_KEY = 'mockingbird_shortener_proxy_consent';

export interface ProxyConsentRecord {
  shortener: ShortenerId;
  proxy: CorsProxyId;
  /** Epoch ms when the user accepted. Shown on the connector page. */
  grantedAt: number;
}

/** A consent key. Not a display string — never rendered. */
function pairKey(shortener: ShortenerId, proxy: CorsProxyId): string {
  return `${shortener}:${proxy}`;
}

function load(): Record<string, ProxyConsentRecord> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, ProxyConsentRecord>)
      : {};
  } catch {
    return {};
  }
}

@Injectable({ providedIn: 'root' })
export class ShortenerProxyConsent {
  private records = signal<Record<string, ProxyConsentRecord>>(load());

  /** Whether this exact pairing has been agreed to. */
  granted(shortener: ShortenerId, proxy: CorsProxyId): boolean {
    return pairKey(shortener, proxy) in this.records();
  }

  /** The record for a pairing, for UI that shows when consent was given. */
  record(shortener: ShortenerId, proxy: CorsProxyId): ProxyConsentRecord | null {
    return this.records()[pairKey(shortener, proxy)] ?? null;
  }

  /** Every consent on file, newest first, for the connector page to list and revoke. */
  all(): ProxyConsentRecord[] {
    return Object.values(this.records()).sort((a, b) => b.grantedAt - a.grantedAt);
  }

  /**
   * Record an acceptance.
   *
   * Called only from the dialog that presented the risk in full. Nothing else
   * should call this — a consent granted without the user having read the
   * disclosure is worse than no consent, because it looks like one.
   */
  grant(shortener: ShortenerId, proxy: CorsProxyId): void {
    const record: ProxyConsentRecord = { shortener, proxy, grantedAt: Date.now() };
    this.write({ ...this.records(), [pairKey(shortener, proxy)]: record });
  }

  /** Withdraw one consent. The next request through that pair asks again. */
  revoke(shortener: ShortenerId, proxy: CorsProxyId): void {
    const next = { ...this.records() };
    delete next[pairKey(shortener, proxy)];
    this.write(next);
  }

  /** Withdraw everything — used when the shortener connector is disconnected. */
  revokeAll(shortener?: ShortenerId): void {
    if (!shortener) {
      this.write({});
      return;
    }
    const next = Object.fromEntries(
      Object.entries(this.records()).filter(([, record]) => record.shortener !== shortener),
    );
    this.write(next);
  }

  private write(next: Record<string, ProxyConsentRecord>): void {
    this.records.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Honoured for this session; the user is re-asked in the next one, which
      // is the safe direction to fail.
    }
  }
}
