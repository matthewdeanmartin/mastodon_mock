import { Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { ClientPrefs } from './client-prefs';
import { Account } from './models';
import { AnonymousAccount } from './providers/anonymous/anonymous-account';
import { Server } from './server';

const TOKEN_KEY = 'mastodon_mock_token';
const SESSIONS_KEY = 'mastodon_mock_sessions';
/**
 * Bearer tokens, split out of {@link SESSIONS_KEY} and keyed by session id.
 *
 * The session list — which accounts, on which instances — is exactly what a
 * settings export wants to carry, and the token is exactly what it must never
 * carry. Keeping them in one object made that impossible to express, so the
 * secret lives here and the two are joined by `Session.id`. See
 * `storage-registry.ts`.
 */
const SESSION_TOKENS_KEY = 'mastodon_mock_session_tokens';
export const ACCOUNT_MODE_KEY = 'mastodon_mock_account_mode';

export type AccountMode = 'mastodon' | 'anonymous';

/** A saved login: a token plus a snapshot of the account it belongs to. */
export interface Session {
  /** Stable local id joining this session to its token in storage. */
  id: string;
  token: string;
  /**
   * Instance this token belongs to (base URL, e.g. "https://mastodon.social"; "" means
   * "this server"). A token is only valid against its own instance, so switching accounts
   * must restore this server first — otherwise verify_credentials hits the wrong host and
   * 401s. May be undefined for sessions saved before this field existed.
   */
  server?: string;
  /** Account snapshot for the switcher UI (avatar, name). Refreshed on verify. */
  account: Account | null;
}

/** One row in the account switcher, including the permanent virtual account. */
export interface AccountChoice {
  key: string;
  kind: AccountMode;
  token: string | null;
  server: string;
  account: Account | null;
}

/** The non-secret half of a saved session, as persisted. */
type StoredSession = Omit<Session, 'token'>;

/**
 * Rejoin the session list with its tokens.
 *
 * A session whose token is missing is dropped: without it there is nothing to
 * authenticate with, so keeping the row would only offer the user a login that
 * cannot work. That is also what happens after importing settings on a new
 * machine — the accounts come back as soon as they are signed into again.
 */
function loadSessions(): Session[] {
  try {
    const rows = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '[]') as unknown;
    const tokens = JSON.parse(localStorage.getItem(SESSION_TOKENS_KEY) ?? '{}') as Record<
      string,
      string
    >;
    if (!Array.isArray(rows)) {
      return [];
    }
    return (rows as StoredSession[])
      .filter((row) => typeof row?.id === 'string' && typeof tokens[row.id] === 'string')
      .map((row) => ({ ...row, token: tokens[row.id] }));
  } catch {
    return [];
  }
}

/** A fresh session id. Opaque and local — never derived from the token. */
function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Holds the active access token plus a Twitter-style stable of saved sessions so a
 * tester can switch accounts without re-pasting tokens. The active token is mirrored
 * to ``TOKEN_KEY`` for the interceptor and back-compat.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private server = inject(Server);
  private anonymous = inject(AnonymousAccount);
  private prefs = inject(ClientPrefs);

  readonly mode = signal<AccountMode | null>(
    localStorage.getItem(ACCOUNT_MODE_KEY) === 'anonymous'
      ? 'anonymous'
      : localStorage.getItem(TOKEN_KEY)
        ? 'mastodon'
        : null,
  );

  readonly token = signal<string | null>(
    this.mode() === 'mastodon' ? localStorage.getItem(TOKEN_KEY) : null,
  );
  private mastodonAccount = signal<Account | null>(null);
  readonly account = linkedSignal(() =>
    this.mode() === 'anonymous' ? this.anonymous.account() : this.mastodonAccount(),
  );

  /** Every account the tester has logged into and not removed. */
  readonly sessions = signal<Session[]>(loadSessions());

  /** Saved sessions other than the active one (for the "switch to" menu). */
  readonly otherSessions = computed<AccountChoice[]>(() => {
    const choices: AccountChoice[] = this.sessions()
      .filter((s) => this.mode() !== 'mastodon' || s.token !== this.token())
      .map((s) => ({
        key: `mastodon:${s.id}`,
        kind: 'mastodon' as const,
        token: s.token,
        server: s.server ?? '',
        account: s.account,
      }));
    if (this.mode() !== 'anonymous') {
      choices.push({
        key: 'anonymous',
        kind: 'anonymous',
        token: null,
        server: this.anonymous.server(),
        account: this.anonymous.account(),
      });
    }
    return choices;
  });

  get isAuthenticated(): boolean {
    return this.mode() !== null;
  }

  get isAnonymous(): boolean {
    return this.mode() === 'anonymous';
  }

  /** Whether Anonymous is the only account available in this browser. */
  get shouldOfferLogin(): boolean {
    return this.isAnonymous && this.sessions().length === 0;
  }

  /**
   * Make ``token`` active, adding it to the saved stable if it's new. Captures the
   * currently-selected instance so the session can be restored to the right host later.
   */
  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ACCOUNT_MODE_KEY, 'mastodon');
    this.mode.set('mastodon');
    this.token.set(token);
    const server = this.server.baseUrl();
    const existing = this.sessions().find((s) => s.token === token);
    if (!existing) {
      this.persistSessions([
        ...this.sessions(),
        { id: newSessionId(), token, server, account: null },
      ]);
    } else if (existing.server === undefined) {
      // Backfill the server for a legacy session created before this field existed.
      this.persistSessions(this.sessions().map((s) => (s.token === token ? { ...s, server } : s)));
    }
  }

  /** Record the verified account for the active token (updates the switcher snapshot). */
  setAccount(account: Account | null): void {
    if (this.isAnonymous) {
      if (account) {
        this.anonymous.updateAccount(account);
      }
      return;
    }
    this.mastodonAccount.set(account);
    this.account.set(account);
    // Mirror the server-side posting default so the composer can open on it
    // without a request. `source` is only populated on verify_credentials, so
    // this quietly no-ops for the account snapshots that lack it.
    this.prefs.setDefaultVisibility(account?.source?.privacy);
    const token = this.token();
    if (account && token) {
      this.persistSessions(this.sessions().map((s) => (s.token === token ? { ...s, account } : s)));
    }
  }

  /**
   * Switch to a previously-saved session. Restores that session's instance first so API
   * calls target the host the token is valid for. Returns false if unknown.
   */
  switchTo(token: string): boolean {
    const session = this.sessions().find((s) => s.token === token);
    if (!session) {
      return false;
    }
    if (session.server !== undefined) {
      this.server.setBaseUrl(session.server);
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ACCOUNT_MODE_KEY, 'mastodon');
    this.mode.set('mastodon');
    this.token.set(token);
    this.mastodonAccount.set(session.account);
    return true;
  }

  /** Enter the permanent local account without deleting any saved logins. */
  enterAnonymous(server?: string): void {
    this.anonymous.activate(server);
    this.server.setBaseUrl(this.anonymous.server());
    localStorage.removeItem(TOKEN_KEY);
    localStorage.setItem(ACCOUNT_MODE_KEY, 'anonymous');
    this.token.set(null);
    this.mastodonAccount.set(null);
    this.mode.set('anonymous');
  }

  /** Switch either to the virtual account or to a saved Mastodon token. */
  switchAccount(choice: AccountChoice): boolean {
    if (choice.kind === 'anonymous') {
      this.enterAnonymous();
      return true;
    }
    return choice.token !== null && this.switchTo(choice.token);
  }

  /**
   * Prepare to sign in again as a saved account whose token was rejected.
   *
   * Points the app at that account's instance and clears the active token,
   * *without* deleting the saved session — if the user abandons the login page
   * the account is still in the switcher. Deliberately does not activate the
   * dead token: leaving a known-bad token active makes every subsequent request
   * 401 and the app look broken.
   */
  prepareReauth(token: string): void {
    const session = this.sessions().find((s) => s.token === token);
    if (session?.server !== undefined) {
      this.server.setBaseUrl(session.server);
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_MODE_KEY);
    this.mode.set(null);
    this.token.set(null);
    this.mastodonAccount.set(null);
  }

  /**
   * Drop the active identity without touching the saved stable. Used when a
   * switch fails and there is nothing to revert to, so the app must not be left
   * holding a token its server rejects.
   */
  exitToLoggedOut(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_MODE_KEY);
    this.mode.set(null);
    this.token.set(null);
    this.mastodonAccount.set(null);
  }

  /** Forget one saved session. If it was active, fall back to another (or sign out). */
  removeSession(token: string): void {
    const remaining = this.sessions().filter((s) => s.token !== token);
    this.persistSessions(remaining);
    if (this.token() === token) {
      const next = remaining[0];
      if (next) {
        this.switchTo(next.token);
      } else {
        this.logout();
      }
    }
  }

  /** Sign out of the active account only, keeping the rest of the stable. */
  logout(): void {
    if (this.isAnonymous) {
      const next = this.sessions()[0];
      if (next) {
        this.switchTo(next.token);
        return;
      }
      localStorage.removeItem(ACCOUNT_MODE_KEY);
      this.mode.set(null);
      this.token.set(null);
      this.mastodonAccount.set(null);
      return;
    }
    const remaining = this.sessions().filter((s) => s.token !== this.token());
    this.persistSessions(remaining);
    const next = remaining[0];
    if (next) {
      this.switchTo(next.token);
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_MODE_KEY);
    this.mode.set(null);
    this.token.set(null);
    this.mastodonAccount.set(null);
  }

  /** Leave Anonymous for the login screen without activating or deleting a saved account. */
  exitAnonymous(): void {
    if (!this.isAnonymous) {
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_MODE_KEY);
    this.mode.set(null);
    this.token.set(null);
    this.mastodonAccount.set(null);
  }

  /** Forget every saved session and sign out entirely. */
  logoutAll(): void {
    this.persistSessions([]);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_MODE_KEY);
    this.mode.set(null);
    this.token.set(null);
    this.mastodonAccount.set(null);
  }

  /**
   * Persist the stable list and the tokens to separate keys, so the list can be
   * exported and the tokens never can.
   */
  private persistSessions(sessions: Session[]): void {
    this.sessions.set(sessions);
    const rows: StoredSession[] = sessions.map(({ token: _token, ...rest }) => rest);
    const tokens = Object.fromEntries(sessions.map((s) => [s.id, s.token]));
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(rows));
    localStorage.setItem(SESSION_TOKENS_KEY, JSON.stringify(tokens));
  }
}
