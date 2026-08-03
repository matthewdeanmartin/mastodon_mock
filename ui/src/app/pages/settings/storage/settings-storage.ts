import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { inspectAccountData } from '../../../account-data';
import { Auth } from '../../../auth';
import {
  clearIndexedDbStore,
  DatabaseInfo,
  IndexedDbReport,
  inspectIndexedDb,
  StoreInfo,
} from '../../../observability/indexed-db-inspector';
import {
  formatBytes,
  StorageEntry,
  StorageReport,
} from '../../../observability/local-storage-inspector';
import { AnonymousAccount } from '../../../providers/anonymous/anonymous-account';

interface StorageAccount {
  key: string;
  label: string;
  detail: string;
  token: string | null;
  active: boolean;
}

/** Browser storage manager for every saved account plus origin-wide IndexedDB caches. */
@Component({
  selector: 'app-settings-storage',
  imports: [FormsModule],
  templateUrl: './settings-storage.html',
  styleUrl: './settings-storage.css',
})
export class SettingsStorage {
  private readonly auth = inject(Auth);
  private readonly anonymous = inject(AnonymousAccount);

  protected readonly formatBytes = formatBytes;
  protected readonly accounts = computed<StorageAccount[]>(() => {
    const activeToken = this.auth.token();
    const rows = this.auth.sessions().map((session): StorageAccount => {
      const account = session.account;
      const host = (session.server ?? '').replace(/^https?:\/\//, '') || 'this server';
      return {
        key: `mastodon:${session.id}`,
        label: account?.display_name || account?.username || 'Unverified account',
        detail: account?.acct ? `@${account.acct}` : host,
        token: session.token,
        active: this.auth.mode() === 'mastodon' && session.token === activeToken,
      };
    });
    rows.push({
      key: 'anonymous',
      label: 'Anonymous (local)',
      detail: `@${this.anonymous.account().acct}`,
      token: null,
      active: this.auth.mode() === 'anonymous',
    });
    return rows;
  });

  protected readonly selectedAccount = signal(this.initialAccountKey());
  protected readonly storage = signal<StorageReport>(this.inspectSelectedAccount());
  protected readonly idb = signal<IndexedDbReport | null>(null);
  protected readonly idbLoading = signal(false);
  protected readonly idbError = signal('');

  constructor() {
    void this.refreshIndexedDb();
  }

  protected selectAccount(key: string): void {
    this.selectedAccount.set(key);
    this.storage.set(this.inspectSelectedAccount());
  }

  deleteKey(entry: StorageEntry): void {
    if (!confirm(`Delete local storage key "${entry.key}"? This can't be undone.`)) {
      return;
    }
    localStorage.removeItem(entry.key);
    this.storage.set(this.inspectSelectedAccount());
  }

  clearAll(): void {
    const entries = this.storage().entries;
    const account = this.selected();
    if (
      !entries.length ||
      !confirm(
        `Clear all local storage for ${account?.label ?? 'this account'}? This can't be undone.`,
      )
    ) {
      return;
    }
    for (const entry of entries) {
      localStorage.removeItem(entry.key);
    }
    if (account?.active) {
      location.reload();
    } else {
      this.storage.set(this.inspectSelectedAccount());
    }
  }

  protected async refreshIndexedDb(): Promise<void> {
    this.idbLoading.set(true);
    this.idbError.set('');
    try {
      this.idb.set(await inspectIndexedDb());
    } finally {
      this.idbLoading.set(false);
    }
  }

  protected async clearStore(database: DatabaseInfo, store: StoreInfo): Promise<void> {
    const label = this.storeLabel(database.name, store.name);
    if (
      !store.count ||
      !confirm(`Delete all ${store.count} records in ${label}? This can't be undone.`)
    ) {
      return;
    }
    this.idbLoading.set(true);
    this.idbError.set('');
    try {
      await clearIndexedDbStore(database.name, store.name);
      this.idb.set(await inspectIndexedDb());
    } catch (error: unknown) {
      this.idbError.set(
        error instanceof Error ? error.message : 'IndexedDB data could not be deleted.',
      );
    } finally {
      this.idbLoading.set(false);
    }
  }

  protected storeLabel(database: string, store: string): string {
    const known: Record<string, string> = {
      'mockingbird_rss/feeds': 'RSS feed cache',
      'mockingbird_twitter/timelines': 'Twitter timeline cache',
    };
    return known[`${database}/${store}`] ?? `${database} / ${store}`;
  }

  protected quotaLabel(): string {
    const quota = this.idb()?.quota;
    if (!quota || quota.usage === null) {
      return 'Browser storage usage unavailable';
    }
    return quota.quota === null
      ? `${formatBytes(quota.usage)} used`
      : `${formatBytes(quota.usage)} of ${formatBytes(quota.quota)} used`;
  }

  private initialAccountKey(): string {
    if (this.auth.mode() === 'mastodon') {
      const token = this.auth.token();
      const active = this.auth.sessions().find((session) => session.token === token);
      if (active) {
        return `mastodon:${active.id}`;
      }
    }
    return 'anonymous';
  }

  private selected(): StorageAccount | undefined {
    return this.accounts().find((account) => account.key === this.selectedAccount());
  }

  private inspectSelectedAccount(): StorageReport {
    const account = this.selected();
    return account ? inspectAccountData(account.token) : { entries: [], totalBytes: 0 };
  }
}
