import { Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { Account } from './models';
import { AnonymousAccount } from './providers/anonymous/anonymous-account';
import { Server } from './server';

const TOKEN_KEY = 'mastodon_mock_token';
const SESSIONS_KEY = 'mastodon_mock_sessions';
export const ACCOUNT_MODE_KEY = 'mastodon_mock_account_mode';

export type AccountMode = 'mastodon' | 'anonymous';

/** A saved login: a token plus a snapshot of the account it belongs to. */
export interface Session {
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

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
        key: `mastodon:${s.token}`,
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
      this.persistSessions([...this.sessions(), { token, server, account: null }]);
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

  /** Forget every saved session and sign out entirely. */
  logoutAll(): void {
    this.persistSessions([]);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_MODE_KEY);
    this.mode.set(null);
    this.token.set(null);
    this.mastodonAccount.set(null);
  }

  private persistSessions(sessions: Session[]): void {
    this.sessions.set(sessions);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
}
