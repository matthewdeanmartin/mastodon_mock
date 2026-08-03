import { computed, Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';
import {
  credentialExpired,
  credentialExpiresAt,
  ensureStamped,
  ExpiringConnection,
  ExpiringCredential,
  stampCredential,
} from '../credential-lifetime';

const STORAGE_KEY_BASE = 'mockingbird_mataroa_connection';

export interface MataroaConnection extends ExpiringCredential {
  apiKey: string;
  blogUrl: string;
  includeInProfile: boolean;
}

function load(key: string): MataroaConnection | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<MataroaConnection>;
    if (!parsed || typeof parsed.apiKey !== 'string' || typeof parsed.blogUrl !== 'string') {
      return null;
    }
    return ensureStamped(key, {
      apiKey: parsed.apiKey,
      blogUrl: normalizeBlogUrl(parsed.blogUrl),
      includeInProfile: parsed.includeInProfile === true,
      connectedAt: parsed.connectedAt,
    });
  } catch {
    return null;
  }
}

/** One Mataroa blog linked to the current Mawkingbird account. */
@Injectable({ providedIn: 'root' })
export class MataroaSettings implements ExpiringConnection {
  private readonly storageKey = scopedKey(STORAGE_KEY_BASE);
  private readonly connection = signal<MataroaConnection | null>(load(this.storageKey));

  readonly connected = computed(() => this.connection() !== null);
  readonly blogUrl = computed(() => this.connection()?.blogUrl ?? null);
  readonly feedUrl = computed(() => {
    const blogUrl = this.blogUrl();
    return blogUrl ? new URL('rss/', blogUrl).toString() : null;
  });
  readonly includeInProfile = computed(() => this.connection()?.includeInProfile === true);

  connect(apiKey: string, blogUrl: string, includeInProfile = false): void {
    const key = apiKey.trim();
    if (!key) {
      throw new Error('Paste your Mataroa API key.');
    }
    const next = stampCredential({
      apiKey: key,
      blogUrl: normalizeBlogUrl(blogUrl),
      includeInProfile,
    });
    localStorage.setItem(this.storageKey, JSON.stringify(next));
    this.connection.set(next);
  }

  resolve(): MataroaConnection | null {
    return this.connection();
  }

  setIncludeInProfile(include: boolean): void {
    const current = this.connection();
    if (!current) {
      return;
    }
    const next = { ...current, includeInProfile: include };
    localStorage.setItem(this.storageKey, JSON.stringify(next));
    this.connection.set(next);
  }

  disconnect(): void {
    localStorage.removeItem(this.storageKey);
    this.connection.set(null);
  }

  expiresAt(): number | null {
    return credentialExpiresAt(this.connection()?.connectedAt);
  }

  enforceLifetime(): void {
    const current = this.connection();
    if (current && credentialExpired(current.connectedAt)) {
      this.disconnect();
    }
  }
}

export function normalizeBlogUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    throw new Error('Enter your public Mataroa blog address.');
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Enter a valid public blog address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The blog address must start with https:// or http://.');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}
