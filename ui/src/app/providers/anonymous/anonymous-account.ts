import { computed, Injectable, signal } from '@angular/core';
import { Account } from '../../models';
import { normalizeHostUrl } from '../../host-url';

const STORAGE_KEY = 'mockingbird_anonymous_account';
const DEFAULT_SERVER = 'https://mastodon.social';
const STATE_VERSION = 1;

interface AnonymousAccountState {
  version: typeof STATE_VERSION;
  server: string;
  account: Account;
}

function host(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return 'mastodon.social';
  }
}

function defaultAccount(server: string): Account {
  const instance = host(server);
  return {
    id: 'anonymous',
    username: instance,
    acct: instance,
    display_name: 'Anonymous',
    note: '',
    url: '',
    avatar: 'favicon-32x32.png',
    avatar_static: 'favicon-32x32.png',
    header: '',
    header_static: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    discoverable: false,
    fields: [],
    role: null,
    source: {
      privacy: 'public',
      sensitive: false,
      language: null,
      note: '',
      fields: [],
    },
  };
}

function loadState(): AnonymousAccountState | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<AnonymousAccountState> | null;
    if (
      parsed?.version !== STATE_VERSION ||
      typeof parsed.server !== 'string' ||
      !parsed.account ||
      parsed.account.id !== 'anonymous'
    ) {
      return null;
    }
    return parsed as AnonymousAccountState;
  } catch {
    return null;
  }
}

/**
 * Owns the single browser-local Anonymous identity.
 *
 * Other anonymous social state will join this provider namespace in later
 * sprints. Auth only selects this identity; profile details never become part
 * of the authenticated Mastodon session format.
 */
@Injectable({ providedIn: 'root' })
export class AnonymousAccount {
  private state = signal<AnonymousAccountState | null>(loadState());

  readonly server = computed(() => this.state()?.server ?? DEFAULT_SERVER);
  readonly account = computed(() => this.state()?.account ?? defaultAccount(this.server()));

  /** Activate the identity, optionally moving its home-instance context. */
  activate(server?: string): void {
    const normalized =
      normalizeHostUrl(server ?? this.state()?.server ?? DEFAULT_SERVER) || DEFAULT_SERVER;
    const current = this.state();
    if (current) {
      const oldHost = host(current.server);
      const newHost = host(normalized);
      const account = {
        ...current.account,
        username: current.account.username === oldHost ? newHost : current.account.username,
        acct: current.account.acct === oldHost ? newHost : current.account.acct,
      };
      this.persist({ ...current, server: normalized, account });
      return;
    }
    this.persist({
      version: STATE_VERSION,
      server: normalized,
      account: defaultAccount(normalized),
    });
  }

  /** Replace locally editable profile fields without exposing storage to the UI. */
  updateAccount(account: Account): void {
    this.persist({
      version: STATE_VERSION,
      server: this.server(),
      account: { ...account, id: 'anonymous' },
    });
  }

  private persist(state: AnonymousAccountState): void {
    this.state.set(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
