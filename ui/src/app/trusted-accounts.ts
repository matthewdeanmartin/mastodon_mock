import { Injectable, computed, signal } from '@angular/core';
import { scopedKey } from './account-scope';
import { accountKey } from './local-moderation';
import { Account } from './models';

const BASE_KEY = 'mockingbird_trusted_accounts';
const STATE_VERSION = 1;

/** One trusted account. */
interface Entry {
  /** Display handle, so the management list can name who is trusted. */
  acct: string;
  /** When they were trusted, epoch-ms — lets the list sort by most recent. */
  since: number;
}

interface StoredState {
  version: typeof STATE_VERSION;
  /** account key (see {@link accountKey}) → entry */
  entries: Record<string, Entry>;
  /** Expand every content warning, from anyone. */
  expandAllCw: boolean;
  /** Show every sensitive image, from anyone. */
  showAllSensitive: boolean;
}

/**
 * The flipside of block and mute: people whose posts don't need hiding.
 *
 * Content warnings and sensitive flags are the author's judgement about *their*
 * audience, not about you. For accounts you read constantly, clicking through
 * the same CW twenty times a day is friction with no safety benefit — you
 * already know what you are going to get. Trusting an account means its posts
 * render as though they carried no CW and no sensitive flag.
 *
 * ## What trust does *not* do
 *
 * It never overrides a *filter*. A word filter or a server-side `hide` is the
 * viewer's own rule or the server's, and one person being trusted is not a
 * reason to break it — {@link ../status-card} keeps its filter handling ahead of
 * this. Trust only relaxes the two flags that are the author's call.
 *
 * ## Storage
 *
 * Client-side and per-Mastodon-account, via {@link scopedKey}: who you trust is
 * a personal reading preference, it needs to work anonymously and against any
 * instance (Mastodon has no such concept to sync with), and switching accounts
 * must not carry one identity's trust list into another's.
 *
 * Deliberately **not** timed, unlike a mute: trust is a standing judgement about
 * a person, and one that silently expired would restore the blur without ever
 * saying why.
 */
@Injectable({ providedIn: 'root' })
export class TrustedAccounts {
  private state = signal<StoredState>(load());

  /** Live view of the entries, so cards re-evaluate when trust changes. */
  readonly entries = computed(() => this.state().entries);

  /**
   * Every trusted account, newest first, for the management list.
   *
   * Ties break alphabetically rather than being left to insertion order: two
   * accounts trusted in the same millisecond is entirely possible (a couple of
   * quick clicks), and a list that reshuffles between renders is worse than one
   * whose ordering is occasionally arbitrary but always the same.
   */
  readonly list = computed(() =>
    Object.entries(this.entries())
      .map(([key, entry]) => ({ key, ...entry }))
      .sort((a, b) => b.since - a.since || a.acct.localeCompare(b.acct)),
  );

  readonly count = computed(() => Object.keys(this.entries()).length);

  /** Expand every CW regardless of author. */
  readonly expandAllCw = computed(() => this.state().expandAllCw);
  /** Show every sensitive image regardless of author. */
  readonly showAllSensitive = computed(() => this.state().showAllSensitive);

  /** True when this specific account has been trusted. */
  isTrusted(account: Pick<Account, 'acct' | 'url' | 'id'>): boolean {
    return accountKey(account) in this.entries();
  }

  /**
   * Should this post's content warning render already open?
   *
   * True when the account-wide switch is on, or the author is trusted. Callers
   * pass the *displayed* account (the booster's target, not the booster) —
   * trusting someone is about what they write, and a boost is someone else's
   * content passing through.
   */
  cwExpanded(account: Pick<Account, 'acct' | 'url' | 'id'> | null | undefined): boolean {
    return this.expandAllCw() || (!!account && this.isTrusted(account));
  }

  /** Should this post's sensitive media render unblurred? Same rule as CWs. */
  sensitiveShown(account: Pick<Account, 'acct' | 'url' | 'id'> | null | undefined): boolean {
    return this.showAllSensitive() || (!!account && this.isTrusted(account));
  }

  trust(account: Pick<Account, 'acct' | 'url' | 'id'>): void {
    const key = accountKey(account);
    const entry: Entry = {
      acct: account.acct || account.url || account.id,
      since: Date.now(),
    };
    this.state.update((prev) =>
      this.persist({ ...prev, entries: { ...prev.entries, [key]: entry } }),
    );
  }

  /** Withdraw trust. Accepts a raw key so the settings list can remove by row. */
  untrust(account: Pick<Account, 'acct' | 'url' | 'id'> | string): void {
    const key = typeof account === 'string' ? account : accountKey(account);
    this.state.update((prev) => {
      if (!(key in prev.entries)) {
        return prev;
      }
      const entries = { ...prev.entries };
      delete entries[key];
      return this.persist({ ...prev, entries });
    });
  }

  /** Flip trust for one account, returning the state it landed in. */
  toggle(account: Pick<Account, 'acct' | 'url' | 'id'>): boolean {
    const trusted = this.isTrusted(account);
    if (trusted) {
      this.untrust(account);
    } else {
      this.trust(account);
    }
    return !trusted;
  }

  setExpandAllCw(on: boolean): void {
    this.state.update((prev) => this.persist({ ...prev, expandAllCw: on }));
  }

  setShowAllSensitive(on: boolean): void {
    this.state.update((prev) => this.persist({ ...prev, showAllSensitive: on }));
  }

  /** Forget every trusted account. The switches are left alone. */
  clearAll(): void {
    this.state.update((prev) => this.persist({ ...prev, entries: {} }));
  }

  private persist(next: StoredState): StoredState {
    try {
      localStorage.setItem(scopedKey(BASE_KEY), JSON.stringify(next));
    } catch {
      // A full or blocked localStorage must not break rendering — the in-memory
      // signal is still updated, so trust works for this session either way.
    }
    return next;
  }
}

function load(): StoredState {
  const empty: StoredState = {
    version: STATE_VERSION,
    entries: {},
    expandAllCw: false,
    showAllSensitive: false,
  };
  try {
    const parsed = JSON.parse(
      localStorage.getItem(scopedKey(BASE_KEY)) ?? 'null',
    ) as Partial<StoredState> | null;
    if (parsed?.version !== STATE_VERSION || typeof parsed.entries !== 'object' || !parsed.entries) {
      return empty;
    }
    const entries: Record<string, Entry> = {};
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (entry && typeof entry === 'object') {
        entries[key] = {
          acct: typeof entry.acct === 'string' ? entry.acct : key,
          since: typeof entry.since === 'number' ? entry.since : 0,
        };
      }
    }
    return {
      version: STATE_VERSION,
      entries,
      expandAllCw: parsed.expandAllCw === true,
      showAllSensitive: parsed.showAllSensitive === true,
    };
  } catch {
    return empty;
  }
}
