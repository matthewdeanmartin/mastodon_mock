import { Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';
import {
  ExpiringConnection,
  credentialExpired,
  credentialExpiresAt,
  stampCredential,
} from '../credential-lifetime';

/**
 * The GitHub token that may write gists.
 *
 * **Deliberately not the token `GitHubSession` holds**, and for exactly the
 * reason `HugoSettings` keeps its own: that one is a read-only PAT for
 * notifications and profile lookups, and this one can create and rewrite gists
 * on the account. Sharing a single token would silently widen the scope an
 * existing connection needs, and put every gist a user owns behind one leaked
 * string.
 *
 * A classic PAT with the `gist` scope is all this needs — nothing else, and in
 * particular not `repo`. Say so wherever it is asked for.
 *
 * Split into two keys the same way the other two GitHub credentials are: a
 * settings export can carry "gists are on" without carrying the credential.
 * The flag is `private`, the token is `secret`. See `storage-registry.ts`.
 */
const CREDENTIALS_KEY_BASE = 'mockingbird_gist_credentials';
const PROFILE_KEY_BASE = 'mockingbird_gist_profile';

/** The non-secret half: who the token belongs to, for display. */
export interface GistProfile {
  login: string;
}

interface StoredGistCredentials {
  accessToken: string;
  connectedAt?: number;
}

@Injectable({ providedIn: 'root' })
export class GistSettings implements ExpiringConnection {
  private readonly credentialsKey = scopedKey(CREDENTIALS_KEY_BASE);
  private readonly profileKey = scopedKey(PROFILE_KEY_BASE);

  private credentials = signal<StoredGistCredentials | null>(readJson(this.credentialsKey));
  readonly profile = signal<GistProfile | null>(readJson(this.profileKey));

  /** True when a token is stored. The provider offers itself only then. */
  readonly connected = signal(readJson<StoredGistCredentials>(this.credentialsKey) !== null);

  /** The write token, or null. Only the gist API should need this. */
  token(): string | null {
    return this.credentials()?.accessToken ?? null;
  }

  connect(accessToken: string, profile: GistProfile): void {
    const trimmed = accessToken.trim();
    if (!trimmed) {
      throw new Error('Paste a GitHub personal access token with the gist scope.');
    }
    const stamped = stampCredential({ accessToken: trimmed });
    write(this.credentialsKey, stamped);
    write(this.profileKey, profile);
    this.credentials.set(stamped);
    this.profile.set(profile);
    this.connected.set(true);
  }

  disconnect(): void {
    remove(this.credentialsKey);
    remove(this.profileKey);
    this.credentials.set(null);
    this.profile.set(null);
    this.connected.set(false);
  }

  /** When this token ages out under the retention policy, or null. */
  expiresAt(): number | null {
    return credentialExpiresAt(this.credentials()?.connectedAt);
  }

  /** Drop the token if it has outlived the retention policy. */
  enforceLifetime(): void {
    if (credentialExpired(this.credentials()?.connectedAt)) {
      this.disconnect();
    }
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the connection degrades to session-only, which is
    // the right failure for a credential.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do; the signal is already cleared.
  }
}
