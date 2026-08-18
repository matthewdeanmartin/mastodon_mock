import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DatabaseInfo,
  IndexedDbReport,
  inspectIndexedDb,
  totalRecords,
} from '../../observability/indexed-db-inspector';
import {
  StorageEntry,
  StorageReport,
  formatBytes,
  inspectLocalStorage,
} from '../../observability/local-storage-inspector';
import { RemoteStorageUsage } from '../../observability/remote-storage-usage';

/**
 * Storage Diagnostics — what this app is keeping on this device, and how much
 * room is left.
 *
 * ## Why it left the Observability page
 *
 * The two pages answer questions that arrive on different days. Observability
 * is about *behaviour over time* — is the API slow, is something erroring, and
 * both of its charts are read by comparing today with last week. Storage is a
 * point-in-time inventory: what is here right now, and what can I delete. They
 * shared a page only because both are diagnostics, which is a statement about
 * their genre rather than about when anyone needs them.
 *
 * Splitting them also makes the destructive controls easier to reason about.
 * Every delete in the app's own storage lives here, so "the page where things
 * can be removed" is one place rather than a section two screens down a page
 * that is otherwise read-only.
 *
 *  - **Local storage** — per-key sizes, with delete. This is where the app
 *    actually keeps its data.
 *  - **IndexedDB & quota** — databases on this origin, and the browser's own
 *    accounting for the whole site, which is what it checks before evicting.
 *
 * Everything here is a live scan of this browser. Nothing is sent anywhere.
 */
@Component({
  selector: 'app-storage-diagnostics',
  imports: [RouterLink],
  templateUrl: './storage-diagnostics.html',
  styleUrls: ['../observability/diagnostics-shared.css', './storage-diagnostics.css'],
})
export class StorageDiagnostics {
  protected readonly formatBytes = formatBytes;
  protected readonly totalRecords = totalRecords;

  constructor() {
    void this.refreshIndexedDb();
  }

  // ---------------------------------------------------- localStorage inspector

  protected readonly storage = signal<StorageReport>(inspectLocalStorage());

  refreshStorage(): void {
    this.storage.set(inspectLocalStorage());
  }

  /** Human label for a known key, so the list isn't just opaque slugs. */
  keyNote(key: string): string {
    if (key.startsWith('mockingbird_api_metrics:')) {
      return 'API metrics';
    }
    if (key === 'mockingbird_route_log') {
      return 'route log';
    }
    if (key.startsWith('mockingbird_')) {
      return 'Mockingbird';
    }
    if (key.startsWith('mastodon_mock_')) {
      return 'session';
    }
    return '';
  }

  deleteKey(entry: StorageEntry): void {
    if (!confirm(`Delete localStorage key "${entry.key}"? This can’t be undone.`)) {
      return;
    }
    localStorage.removeItem(entry.key);
    this.refreshStorage();
  }

  /** The largest keys, which are the ones worth looking at first. */
  protected readonly biggest = computed(() => {
    const entries = this.storage().entries;
    return entries.length ? entries.reduce((a, b) => (b.bytes > a.bytes ? b : a)) : null;
  });

  // ---------------------------------------------------------- remote storage

  private remoteStorage = inject(RemoteStorageUsage);

  protected readonly remote = this.remoteStorage.usage;

  /** Fraction of the remote allowance used, 0–1, or null when unknown. */
  protected remoteRatio(): number | null {
    return this.remoteStorage.ratio();
  }

  /** `"12.4 MB of 100 MB (12.4%)"`. */
  protected remoteLabel(): string {
    const u = this.remote();
    if (!u) {
      return '';
    }
    const ratio = this.remoteRatio();
    const pct = ratio === null ? '' : ` (${(ratio * 100).toFixed(1)}%)`;
    return `${formatBytes(u.used)} of ${formatBytes(u.limit)}${pct}`;
  }

  /** When the figure was read, so a stale number is visibly stale. */
  protected remoteWhen(): string {
    const u = this.remote();
    return u?.at ? new Date(u.at).toLocaleString() : 'never';
  }

  // --------------------------------------------------------------- IndexedDB

  protected readonly idb = signal<IndexedDbReport | null>(null);
  protected readonly idbLoading = signal(false);

  async refreshIndexedDb(): Promise<void> {
    this.idbLoading.set(true);
    try {
      this.idb.set(await inspectIndexedDb());
    } finally {
      this.idbLoading.set(false);
    }
  }

  /** `"12.4 MB of 2.1 GB (0.6%)"`, or a shorter form when the browser is coy. */
  protected quotaLabel(): string {
    const q = this.idb()?.quota;
    if (!q || q.usage === null) {
      return 'Storage usage unavailable in this browser.';
    }
    const used = formatBytes(q.usage);
    if (q.quota === null) {
      return `${used} used`;
    }
    const pct = q.ratio === null ? '' : ` (${(q.ratio * 100).toFixed(1)}%)`;
    return `${used} of ${formatBytes(q.quota)}${pct}`;
  }

  protected storeSummary(db: DatabaseInfo): string {
    if (db.error) {
      return db.error;
    }
    if (!db.stores.length) {
      return 'no object stores';
    }
    return db.stores.map((s) => `${s.name} (${s.count ?? '?'})`).join(', ');
  }
}
