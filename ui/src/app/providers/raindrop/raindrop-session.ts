import { Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';
import { Status } from '../../models';
import {
  credentialExpired,
  credentialExpiresAt,
  ensureStamped,
  ExpiringCredential,
  ExpiringConnection,
  stampCredential,
} from '../credential-lifetime';

const TOKEN_KEY_BASE = 'mockingbird_raindrop_token';
const LEGACY_CREDENTIALS_KEY_BASE = 'mockingbird_raindrop_credentials';

interface StoredRaindropToken extends ExpiringCredential {
  accessToken: string;
}

interface RaindropErrorResponse {
  error?: string | number;
  errorMessage?: string;
}

export type RaindropBookmarkTarget = 'post' | 'external-link';

/**
 * Browser-only Raindrop.io connection using the account's non-expiring Test token.
 *
 * The token is stored **unscoped** — one Raindrop.io connection per browser,
 * shared by every Mastodon account including Anonymous. Raindrop is a private
 * bookmark drawer belonging to the person at the keyboard, not a public identity
 * attached to a persona (that distinction is what {@link ConnectionScope} is
 * about), so making each alt paste the same Test token bought nothing: any of
 * them could read the others' copy out of this same localStorage regardless.
 */
@Injectable({ providedIn: 'root' })
export class RaindropSession implements ExpiringConnection {
  private readonly tokenKey = TOKEN_KEY_BASE;
  private token = signal<StoredRaindropToken | null>(adoptScopedToken(this.tokenKey));

  readonly connected = signal(this.token() !== null);

  constructor() {
    // Do not retain client secrets saved by the superseded OAuth implementation,
    // under either the current or the old per-account key.
    localStorage.removeItem(LEGACY_CREDENTIALS_KEY_BASE);
    localStorage.removeItem(scopedKey(LEGACY_CREDENTIALS_KEY_BASE));
  }

  connect(accessToken: string): void {
    const trimmed = accessToken.trim();
    if (!trimmed) {
      throw new Error('Paste the Test token from your Raindrop.io app settings.');
    }
    const token = stampCredential({ accessToken: trimmed });
    localStorage.setItem(this.tokenKey, JSON.stringify(token));
    this.token.set(token);
    this.connected.set(true);
  }

  /** When this token ages out under the retention policy, or null. */
  expiresAt(): number | null {
    return credentialExpiresAt(this.token()?.connectedAt);
  }

  /** Drop the token if it has outlived the retention policy. */
  enforceLifetime(): void {
    const token = this.token();
    if (token && credentialExpired(token.connectedAt)) {
      this.disconnect();
    }
  }

  async addBookmark(
    status: Status,
    target: RaindropBookmarkTarget,
    externalUrl?: string,
  ): Promise<void> {
    const link = target === 'external-link' ? externalUrl : status.url;
    if (!link) {
      throw new Error(
        target === 'external-link'
          ? 'This post does not contain an external link to save.'
          : 'This post does not have a public URL to save.',
      );
    }
    const accessToken = this.token()?.accessToken;
    if (!accessToken) {
      throw new Error('Connect Raindrop.io in Settings → Connections first.');
    }
    const body =
      target === 'external-link'
        ? { link, pleaseParse: {} }
        : {
            link,
            title: `@${status.account.acct}: ${plainText(status.content).slice(0, 180)}`,
            excerpt: plainText(status.content),
            pleaseParse: {},
          };
    const response = await fetch('https://api.raindrop.io/rest/v1/raindrop', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401) this.disconnect();
      throw new Error(await raindropError(response, "Raindrop.io couldn't save that bookmark."));
    }
  }

  disconnect(): void {
    localStorage.removeItem(this.tokenKey);
    // Also clear the pre-unscoping copy, so "Disconnect" cannot be undone by a
    // reload that finds the old key and adopts it again.
    localStorage.removeItem(scopedKey(TOKEN_KEY_BASE));
    localStorage.removeItem(LEGACY_CREDENTIALS_KEY_BASE);
    this.token.set(null);
    this.connected.set(false);
  }
}

/** Find the first ordinary web link, skipping hashtags and links back to the viewer's instance. */
export function firstExternalLink(content: string, instanceUrl: string): string | null {
  const instanceOrigin = safeOrigin(instanceUrl || location.origin);
  const doc = new DOMParser().parseFromString(content, 'text/html');
  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = anchor.getAttribute('href');
    if (!href || anchor.classList.contains('hashtag')) continue;
    try {
      const url = new URL(href, instanceOrigin ?? location.origin);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (/^\/tags?\/[^/?#]+\/?$/i.test(url.pathname)) continue;
      if (instanceOrigin && url.origin === instanceOrigin) continue;
      return url.toString();
    } catch {
      // Malformed links are not bookmark targets.
    }
  }
  return null;
}

/**
 * Read the unscoped token, migrating the signed-in account's old per-account one
 * up to it if that is all there is.
 *
 * Raindrop used to store under `scopedKey(TOKEN_KEY_BASE)`. Without this, every
 * existing user would silently look disconnected and have to go find their Test
 * token again. The old key is left in place rather than deleted: another account
 * in this browser may still be holding the only copy of *its* token there, and
 * whichever one signs in next adopts it the same way. `disconnect()` clears
 * both, so forgetting still means forgetting.
 */
function adoptScopedToken(key: string): StoredRaindropToken | null {
  const current = readToken(key);
  if (current) {
    return current;
  }
  const legacy = readToken(scopedKey(key));
  if (legacy) {
    localStorage.setItem(key, JSON.stringify(legacy));
  }
  return legacy;
}

function readToken(key: string): StoredRaindropToken | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(key) ?? 'null',
    ) as Partial<StoredRaindropToken> | null;
    if (typeof parsed?.accessToken !== 'string' || !parsed.accessToken) {
      return null;
    }
    const stored = ensureStamped(key, {
      accessToken: parsed.accessToken,
      connectedAt: parsed.connectedAt,
    });
    if (credentialExpired(stored.connectedAt)) {
      localStorage.removeItem(key);
      return null;
    }
    return stored;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
}

async function raindropError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as RaindropErrorResponse;
    return body.errorMessage ?? (typeof body.error === 'string' ? body.error : fallback);
  } catch {
    return fallback;
  }
}
