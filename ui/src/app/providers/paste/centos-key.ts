import { Injectable, signal } from '@angular/core';
import {
  credentialExpired,
  credentialExpiresAt,
  ExpiringConnection,
  ExpiringCredential,
  stampCredential,
} from '../credential-lifetime';

const KEY_BASE = 'mockingbird_centos_paste_key';

interface StoredCentosKey extends ExpiringCredential {
  apiKey: string;
}

function load(): StoredCentosKey | null {
  try {
    const raw = localStorage.getItem(KEY_BASE);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof (parsed as StoredCentosKey).apiKey === 'string'
      ? (parsed as StoredCentosKey)
      : null;
  } catch {
    return null;
  }
}

/**
 * The API key for paste.centos.org, which refuses every endpoint without one.
 *
 * Stored **unscoped** — shared by every account in this browser — because a
 * paste service is not an identity. The key comes from a CentOS account and
 * authorises the *browser* to talk to a pastebin; it says nothing about which
 * Mastodon persona you are, so making each alt paste it again would be busywork
 * with no privacy gain (the alt can read the other copy out of the same
 * localStorage regardless). Same reasoning as OpenRouter and Raindrop; contrast
 * Bluesky, which *is* an identity claim and is scoped per account.
 *
 * Note the split from {@link PasteFeedSubscriptions}: the key is global, but
 * whether CentOS's feed appears in *your* timeline is per-account. One is a
 * capability, the other is a subscription.
 *
 * Governed by the same retention policy as the Connections tokens, so an
 * abandoned key stops being a liability on its own.
 */
@Injectable({ providedIn: 'root' })
export class CentosPasteKey implements ExpiringConnection {
  private stored = signal<StoredCentosKey | null>(load());

  readonly connected = signal(this.stored() !== null);

  /** The key itself, or null when none is set. */
  key(): string | null {
    return this.stored()?.apiKey ?? null;
  }

  connect(apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error('Paste the API key from your paste.centos.org account.');
    }
    const record = stampCredential({ apiKey: trimmed });
    try {
      localStorage.setItem(KEY_BASE, JSON.stringify(record));
    } catch {
      // Storage-disabled browsers keep the key for this session only.
    }
    this.stored.set(record);
    this.connected.set(true);
  }

  disconnect(): void {
    try {
      localStorage.removeItem(KEY_BASE);
    } catch {
      // Nothing to remove when storage is unavailable.
    }
    this.stored.set(null);
    this.connected.set(false);
  }

  /** When this key ages out under the retention policy, or null. */
  expiresAt(): number | null {
    return credentialExpiresAt(this.stored()?.connectedAt);
  }

  /** Drop the key if it has outlived the retention policy. */
  enforceLifetime(): void {
    const record = this.stored();
    if (record && credentialExpired(record.connectedAt)) {
      this.disconnect();
    }
  }
}
