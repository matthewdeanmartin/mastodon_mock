import { Injectable, computed, signal } from '@angular/core';
import { Account } from './models';

const TOKEN_KEY = 'mastodon_mock_token';
const SESSIONS_KEY = 'mastodon_mock_sessions';

/** A saved login: a token plus a snapshot of the account it belongs to. */
export interface Session {
  token: string;
  /** Account snapshot for the switcher UI (avatar, name). Refreshed on verify. */
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
  readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  readonly account = signal<Account | null>(null);

  /** Every account the tester has logged into and not removed. */
  readonly sessions = signal<Session[]>(loadSessions());

  /** Saved sessions other than the active one (for the "switch to" menu). */
  readonly otherSessions = computed(() =>
    this.sessions().filter((s) => s.token !== this.token()),
  );

  get isAuthenticated(): boolean {
    return this.token() !== null;
  }

  /** Make ``token`` active, adding it to the saved stable if it's new. */
  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.token.set(token);
    if (!this.sessions().some((s) => s.token === token)) {
      this.persistSessions([...this.sessions(), { token, account: null }]);
    }
  }

  /** Record the verified account for the active token (updates the switcher snapshot). */
  setAccount(account: Account | null): void {
    this.account.set(account);
    const token = this.token();
    if (account && token) {
      this.persistSessions(
        this.sessions().map((s) => (s.token === token ? { ...s, account } : s)),
      );
    }
  }

  /** Switch to a previously-saved session. Returns false if unknown. */
  switchTo(token: string): boolean {
    const session = this.sessions().find((s) => s.token === token);
    if (!session) {
      return false;
    }
    localStorage.setItem(TOKEN_KEY, token);
    this.token.set(token);
    this.account.set(session.account);
    return true;
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
    const remaining = this.sessions().filter((s) => s.token !== this.token());
    this.persistSessions(remaining);
    const next = remaining[0];
    if (next) {
      this.switchTo(next.token);
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
    this.account.set(null);
  }

  /** Forget every saved session and sign out entirely. */
  logoutAll(): void {
    this.persistSessions([]);
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
    this.account.set(null);
  }

  private persistSessions(sessions: Session[]): void {
    this.sessions.set(sessions);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
}
