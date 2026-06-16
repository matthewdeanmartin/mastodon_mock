import { Injectable, signal } from '@angular/core';
import { Account } from './models';

const TOKEN_KEY = 'mastodon_mock_token';

/** Holds the pasted access token and the verified current account. */
@Injectable({ providedIn: 'root' })
export class Auth {
  readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  readonly account = signal<Account | null>(null);

  get isAuthenticated(): boolean {
    return this.token() !== null;
  }

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.token.set(token);
  }

  setAccount(account: Account | null): void {
    this.account.set(account);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
    this.account.set(null);
  }
}
