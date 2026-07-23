import { Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';
import { Status } from '../../models';

const TOKEN_KEY_BASE = 'mockingbird_raindrop_token';
const LEGACY_CREDENTIALS_KEY_BASE = 'mockingbird_raindrop_credentials';

interface StoredRaindropToken {
  accessToken: string;
}

interface RaindropErrorResponse {
  error?: string | number;
  errorMessage?: string;
}

export type RaindropBookmarkTarget = 'post' | 'external-link';

/** Browser-only Raindrop.io connection using the account's non-expiring Test token. */
@Injectable({ providedIn: 'root' })
export class RaindropSession {
  private readonly tokenKey = scopedKey(TOKEN_KEY_BASE);
  private readonly legacyCredentialsKey = scopedKey(LEGACY_CREDENTIALS_KEY_BASE);
  private token = signal<StoredRaindropToken | null>(readToken(this.tokenKey));
  readonly connected = signal(this.token() !== null);

  constructor() {
    // Do not retain client secrets saved by the superseded OAuth implementation.
    localStorage.removeItem(this.legacyCredentialsKey);
  }

  connect(accessToken: string): void {
    const trimmed = accessToken.trim();
    if (!trimmed) {
      throw new Error('Paste the Test token from your Raindrop.io app settings.');
    }
    const token = { accessToken: trimmed };
    localStorage.setItem(this.tokenKey, JSON.stringify(token));
    this.token.set(token);
    this.connected.set(true);
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
    localStorage.removeItem(this.legacyCredentialsKey);
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

function readToken(key: string): StoredRaindropToken | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(key) ?? 'null',
    ) as Partial<StoredRaindropToken> | null;
    return typeof parsed?.accessToken === 'string' && parsed.accessToken
      ? { accessToken: parsed.accessToken }
      : null;
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
