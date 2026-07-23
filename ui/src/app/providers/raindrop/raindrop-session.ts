import { Injectable, signal } from '@angular/core';
import { Status } from '../../models';
import { scopedKey } from '../../account-scope';

const CREDENTIALS_KEY_BASE = 'mockingbird_raindrop_credentials';
const TOKEN_KEY_BASE = 'mockingbird_raindrop_token';
const STATE_KEY = 'mockingbird_raindrop_oauth_state';

export const RAINDROP_REDIRECT_URL = 'https://mawkingbird.com/raindrop';

export interface RaindropCredentials {
  clientId: string;
  clientSecret: string;
}

interface StoredRaindropToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface RaindropTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface RaindropErrorResponse {
  error?: string | number;
  errorMessage?: string;
}

export type RaindropBookmarkTarget = 'post' | 'external-link';

/** Browser-only Raindrop.io OAuth session and bookmark writer. */
@Injectable({ providedIn: 'root' })
export class RaindropSession {
  private readonly credentialsKey = scopedKey(CREDENTIALS_KEY_BASE);
  private readonly tokenKey = scopedKey(TOKEN_KEY_BASE);
  readonly credentials = signal<RaindropCredentials | null>(
    readStored<RaindropCredentials>(this.credentialsKey),
  );
  private token = signal<StoredRaindropToken | null>(
    readStored<StoredRaindropToken>(this.tokenKey),
  );
  readonly connected = signal(this.hasUsableToken());

  get configured(): boolean {
    const credentials = this.credentials();
    return !!credentials?.clientId.trim() && !!credentials.clientSecret;
  }

  saveCredentials(clientId: string, clientSecret: string): void {
    const credentials = { clientId: clientId.trim(), clientSecret };
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new Error('Enter both the Raindrop.io client ID and client secret.');
    }
    localStorage.setItem(this.credentialsKey, JSON.stringify(credentials));
    this.credentials.set(credentials);
  }

  connect(): void {
    const credentials = this.requireCredentials();
    const state = randomBase64Url(32);
    sessionStorage.setItem(STATE_KEY, state);
    const authorizeUrl = new URL('https://raindrop.io/oauth/authorize');
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: RAINDROP_REDIRECT_URL,
      state,
    }).toString();
    location.assign(authorizeUrl.toString());
  }

  async finishAuthorization(params: URLSearchParams): Promise<void> {
    const oauthError = params.get('error_description') ?? params.get('error');
    if (oauthError) {
      this.clearPendingAuthorization();
      throw new Error(oauthError);
    }
    const code = params.get('code');
    const state = params.get('state');
    const expectedState = sessionStorage.getItem(STATE_KEY);
    if (!code || !state || !expectedState || state !== expectedState) {
      this.clearPendingAuthorization();
      throw new Error(
        'Raindrop.io returned an invalid or expired authorization response. Please try again.',
      );
    }
    try {
      const result = await this.exchangeToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: RAINDROP_REDIRECT_URL,
      });
      this.storeToken(result);
    } finally {
      this.clearPendingAuthorization();
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
    const accessToken = await this.usableAccessToken();
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
      if (response.status === 401) {
        this.disconnect(false);
      }
      throw new Error(await raindropError(response, "Raindrop.io couldn't save that bookmark."));
    }
  }

  disconnect(forgetCredentials = false): void {
    localStorage.removeItem(this.tokenKey);
    this.token.set(null);
    this.connected.set(false);
    if (forgetCredentials) {
      localStorage.removeItem(this.credentialsKey);
      this.credentials.set(null);
    }
  }

  private async usableAccessToken(): Promise<string> {
    const token = this.token();
    if (!token) {
      throw new Error('Connect Raindrop.io in Settings → Connections first.');
    }
    if (token.expiresAt > Date.now() + 30_000) {
      return token.accessToken;
    }
    const result = await this.exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });
    this.storeToken(result);
    return result.access_token;
  }

  private async exchangeToken(fields: Record<string, string>): Promise<RaindropTokenResponse> {
    const credentials = this.requireCredentials();
    const response = await fetch('https://raindrop.io/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...fields,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    });
    if (!response.ok) {
      throw new Error(
        await raindropError(response, 'Raindrop.io rejected the authorization request.'),
      );
    }
    return (await response.json()) as RaindropTokenResponse;
  }

  private storeToken(result: RaindropTokenResponse): void {
    const token: StoredRaindropToken = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: Date.now() + result.expires_in * 1000,
    };
    localStorage.setItem(this.tokenKey, JSON.stringify(token));
    this.token.set(token);
    this.connected.set(true);
  }

  private requireCredentials(): RaindropCredentials {
    const credentials = this.credentials();
    if (!credentials?.clientId.trim() || !credentials.clientSecret) {
      throw new Error('Save your Raindrop.io client ID and client secret first.');
    }
    return credentials;
  }

  private hasUsableToken(): boolean {
    return !!this.token();
  }

  private clearPendingAuthorization(): void {
    sessionStorage.removeItem(STATE_KEY);
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

function readStored<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
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

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function raindropError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as RaindropErrorResponse;
    return body.errorMessage ?? (typeof body.error === 'string' ? body.error : fallback);
  } catch {
    return fallback;
  }
}
