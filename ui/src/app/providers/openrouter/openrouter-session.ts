import { Injectable, signal } from '@angular/core';
import { codeChallengeFor, createCodeVerifier, createOAuthState, statesMatch } from '../../pkce';
import {
  credentialExpired,
  credentialExpiresAt,
  ensureStamped,
  ExpiringConnection,
  ExpiringCredential,
  stampCredential,
} from '../credential-lifetime';

/**
 * A browser-only OpenRouter OAuth/PKCE session.
 *
 * Two things make this different from every other connector here, and both are
 * deliberate:
 *
 * **1. The key is not account-scoped.** Every other credential in the app goes
 * through `scopedKey()`, because a Bluesky link belongs to the Mastodon persona
 * that made it. An LLM key belongs to the *human*: it is the same key whether
 * you are signed in as your main, your alt, or Anonymous, and making you
 * reconnect per persona would be busywork protecting nothing. So these keys are
 * plain, unsuffixed, and shared across every account in this browser. See
 * `storage-registry.ts`, where they are registered `suffix: 'none'`.
 *
 * **2. OpenRouter's authorization step has no `state` parameter.** It accepts
 * only `callback_url`, `code_challenge` and `code_challenge_method`. `state` is
 * not optional security theatre — without it, an attacker can hand this browser
 * a code minted for *their* account and we would silently connect to it. So the
 * state rides inside `callback_url` as a query parameter, which OpenRouter
 * preserves when it appends `code`, and {@link finishAuthorization} verifies it
 * exactly as the Dropbox flow does. If OpenRouter ever starts stripping unknown
 * query params, every connection attempt fails loudly rather than quietly
 * dropping the check — which is the direction you want to fail in.
 */

const KEY_KEY = 'mockingbird_openrouter_key';
const VERIFIER_KEY = 'mockingbird_openrouter_pkce_verifier';
const STATE_KEY = 'mockingbird_openrouter_oauth_state';

const AUTHORIZE_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

/** The stored credential, plus the retention stamp that governs it. */
interface StoredOpenRouterKey extends ExpiringCredential {
  key: string;
  userId?: string;
}

interface ExchangeResponse {
  key: string;
  user_id?: string;
}

@Injectable({ providedIn: 'root' })
export class OpenRouterSession implements ExpiringConnection {
  private stored = signal<StoredOpenRouterKey | null>(readKey());

  readonly connected = signal(this.stored() !== null);

  constructor() {
    this.enforceLifetime();
  }

  /** The API key for callers that need it, or null when not connected. */
  apiKey(): string | null {
    return this.stored()?.key ?? null;
  }

  /** Begin authorization. Navigates away; the callback page finishes the job. */
  async connect(): Promise<void> {
    const verifier = createCodeVerifier();
    const state = createOAuthState();
    const challenge = await codeChallengeFor(verifier);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);

    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.search = new URLSearchParams({
      callback_url: redirectUri(state),
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    location.assign(authorizeUrl.toString());
  }

  /**
   * Complete authorization from the callback URL's query string.
   *
   * `params` carries both OpenRouter's `code` and the `state` we smuggled
   * through `callback_url`. A missing or mismatched state is fatal: no key is
   * stored, the pending flow is cleared, and the caller shows the error.
   */
  async finishAuthorization(params: URLSearchParams): Promise<void> {
    const oauthError = params.get('error_description') ?? params.get('error');
    if (oauthError) {
      this.clearPendingAuthorization();
      throw new Error(oauthError);
    }

    const code = params.get('code');
    const state = params.get('state');
    const expectedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!code || !statesMatch(expectedState, state) || !verifier) {
      this.clearPendingAuthorization();
      throw new Error(
        'OpenRouter returned an invalid or expired authorization response. Please try again.',
      );
    }

    try {
      const response = await fetch(EXCHANGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: verifier,
          code_challenge_method: 'S256',
        }),
      });
      if (!response.ok) {
        throw new Error(
          await openRouterError(response, 'OpenRouter rejected the authorization code.'),
        );
      }
      const result = (await response.json()) as ExchangeResponse;
      if (!result.key) {
        throw new Error('OpenRouter did not return an API key.');
      }
      this.store(stampCredential({ key: result.key, userId: result.user_id }));
    } finally {
      this.clearPendingAuthorization();
    }
  }

  disconnect(): void {
    try {
      localStorage.removeItem(KEY_KEY);
    } catch {
      // Nothing to do — the in-memory clear below still takes effect.
    }
    this.stored.set(null);
    this.connected.set(false);
  }

  /** {@link ExpiringConnection}: drop the key when it outlives the policy. */
  enforceLifetime(): void {
    const stored = this.stored();
    if (stored && credentialExpired(stored.connectedAt)) {
      this.disconnect();
    }
  }

  /** {@link ExpiringConnection}: when the key ages out, or null. */
  expiresAt(): number | null {
    return credentialExpiresAt(this.stored()?.connectedAt);
  }

  private store(value: StoredOpenRouterKey): void {
    try {
      localStorage.setItem(KEY_KEY, JSON.stringify(value));
    } catch {
      // Storage full or blocked: honour the connection for this session anyway.
    }
    this.stored.set(value);
    this.connected.set(true);
  }

  private clearPendingAuthorization(): void {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
  }
}

/**
 * Where OpenRouter sends the user back, carrying our anti-CSRF state.
 *
 * OpenRouter appends `?code=…` (or `&code=…`) to whatever it is given, so a
 * query parameter of ours survives the round trip.
 */
function redirectUri(state: string): string {
  return `${location.origin}/integrations/openrouter/callback?state=${encodeURIComponent(state)}`;
}

function readKey(): StoredOpenRouterKey | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredOpenRouterKey;
    if (typeof parsed?.key !== 'string' || !parsed.key) {
      throw new Error('malformed');
    }
    // Records written before the retention stamp existed start their clock now
    // rather than being treated as instantly expired.
    return ensureStamped(KEY_KEY, parsed);
  } catch {
    try {
      localStorage.removeItem(KEY_KEY);
    } catch {
      // Ignore: unreadable and unremovable is still "not connected".
    }
    return null;
  }
}

/** OpenRouter's error envelope is `{ error: { code, message } }`. */
export async function openRouterError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}
