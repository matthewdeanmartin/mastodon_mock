import { Component, signal } from '@angular/core';
import { accountScopeSuffix } from '../../../account-scope';
import {
  formatBytes,
  inspectLocalStorage,
  StorageEntry,
  StorageReport,
} from '../../../observability/local-storage-inspector';

/** Browser storage belonging to the currently selected local account. */
@Component({
  selector: 'app-settings-storage',
  templateUrl: './settings-storage.html',
  styleUrl: './settings-storage.css',
})
export class SettingsStorage {
  protected readonly formatBytes = formatBytes;
  protected readonly storage = signal<StorageReport>(this.inspectAccountStorage());

  private inspectAccountStorage(): StorageReport {
    const suffix = accountScopeSuffix();
    return inspectLocalStorage((key) => {
      if (suffix === '_anonymous') {
        return key.startsWith('mockingbird_anonymous_') || key.endsWith(suffix);
      }
      return suffix !== '' && key.endsWith(suffix);
    });
  }

  deleteKey(entry: StorageEntry): void {
    if (!confirm(`Delete local storage key "${entry.key}"? This can't be undone.`)) {
      return;
    }
    localStorage.removeItem(entry.key);
    this.storage.set(this.inspectAccountStorage());
  }

  clearAll(): void {
    const entries = this.storage().entries;
    if (
      !entries.length ||
      !confirm(`Clear all local storage for this account? This can't be undone.`)
    ) {
      return;
    }
    for (const entry of entries) {
      localStorage.removeItem(entry.key);
    }
    location.reload();
  }
}
