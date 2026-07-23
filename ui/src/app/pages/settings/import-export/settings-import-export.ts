import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { ImportFollows, parseHandles } from '../../../import-follows';
import { Account, ImportReport } from '../../../models';
import { environment } from '../../../../environments/environment';
import { ContactDiscovery } from './contact-discovery';

type CsvKind = 'following' | 'mutes' | 'blocks';

/** Render accounts in the Mastodon following_accounts.csv format accepted by ImportFollows. */
export function followingAccountsCsv(accounts: readonly Account[]): string {
  const rows = accounts.map((account) => `${exportHandle(account)},true,false,`);
  return ['Account address,Show boosts,Notify on new posts,Languages', ...rows, ''].join('\n');
}

function exportHandle(account: Account): string {
  const acct = account.acct.replace(/^@/, '');
  if (acct.includes('@')) return acct;
  try {
    return `${acct}@${new URL(account.url).host}`;
  } catch {
    return acct;
  }
}

function saveCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Client-side friend import/export, plus mock-server graph tools in mock builds. */
@Component({
  selector: 'app-settings-import-export',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-import-export.html',
  styleUrl: './settings-import-export.css',
})
export class SettingsImportExport {
  private api = inject(Api);
  private auth = inject(Auth);
  protected importer = inject(ImportFollows);
  protected contactDiscovery = inject(ContactDiscovery);

  protected readonly mockTooling = environment.mockTooling;
  protected pasted = signal('');
  protected fileName = signal<string | null>(null);
  protected parseNote = signal<string | null>(null);
  protected exportingFriends = signal(false);
  protected exportCount = signal(0);
  protected exportError = signal<string | null>(null);
  protected contactFileName = signal<string | null>(null);
  protected contactCallLimit = signal(20);

  protected doneCount = computed(
    () =>
      this.importer
        .rows()
        .filter(
          (row) =>
            row.status !== 'pending' && row.status !== 'resolving' && row.status !== 'following',
        ).length,
  );
  protected followedCount = computed(
    () => this.importer.rows().filter((row) => row.status === 'followed').length,
  );
  protected contactMisses = computed(() =>
    this.contactDiscovery
      .rows()
      .filter((row) => row.status === 'complete' && row.matches.length === 0)
      .map((row) => row.contact.name),
  );

  protected importKind = signal<CsvKind>('following');
  protected csvText = signal('');
  protected uploading = signal(false);
  protected report = signal<ImportReport | null>(null);

  protected download(kind: CsvKind): void {
    this.api.exportCsv(kind).subscribe((csv) => {
      saveCsv(csv, `${kind}.csv`);
    });
  }

  protected onServerFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.csvText.set(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  protected upload(): void {
    if (this.uploading() || !this.csvText().trim()) {
      return;
    }
    this.uploading.set(true);
    this.report.set(null);
    this.api.importCsv(this.importKind(), this.csvText()).subscribe({
      next: (report) => {
        this.uploading.set(false);
        this.report.set(report);
      },
      error: () => this.uploading.set(false),
    });
  }

  protected onFriendFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    file.text().then((text) => {
      this.pasted.set(text);
      this.previewFriends();
    });
    input.value = '';
  }

  protected onContactFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.contactFileName.set(file.name);
    file.text().then((text) => this.contactDiscovery.load(text));
    input.value = '';
  }

  protected startContactSearch(): void {
    void this.contactDiscovery.start(this.contactCallLimit());
  }

  protected setContactCallLimit(value: number | string): void {
    const parsed = Number(value);
    this.contactCallLimit.set(
      Number.isFinite(parsed) ? Math.min(1000, Math.max(1, Math.floor(parsed))) : 20,
    );
  }

  protected clearContactSearch(): void {
    this.contactFileName.set(null);
    this.contactDiscovery.reset();
  }

  protected contactStatusLabel(status: string): string {
    switch (status) {
      case 'pending':
        return 'waiting';
      case 'searching':
        return 'searching…';
      case 'complete':
        return 'searched';
      default:
        return 'failed';
    }
  }

  protected previewFriends(): void {
    const handles = parseHandles(this.pasted());
    this.importer.reset();
    this.importer.load(handles);
    this.parseNote.set(
      handles.length
        ? `Found ${handles.length} account${handles.length === 1 ? '' : 's'} to follow.`
        : 'No handles found — expected @user@host, profile URLs, or a Mastodon CSV export.',
    );
  }

  protected startImport(): void {
    void this.importer.start();
  }

  protected clearImport(): void {
    this.pasted.set('');
    this.fileName.set(null);
    this.parseNote.set(null);
    this.importer.reset();
  }

  protected statusLabel(status: string): string {
    switch (status) {
      case 'pending':
        return 'waiting';
      case 'resolving':
        return 'looking up…';
      case 'following':
        return 'following…';
      case 'followed':
        return 'followed ✓';
      case 'not_found':
        return 'not found';
      default:
        return 'failed';
    }
  }

  /** Fetch every following page and download a portable Mastodon follow list. */
  protected async exportFriends(): Promise<void> {
    const accountId = this.auth.account()?.id;
    if (!accountId || this.exportingFriends()) return;
    this.exportingFriends.set(true);
    this.exportCount.set(0);
    this.exportError.set(null);
    const accounts: Account[] = [];
    const seen = new Set<string>();
    let maxId: string | undefined;
    try {
      while (true) {
        const page = await firstValueFrom(this.api.accountFollowing(accountId, maxId, 80));
        for (const account of page) {
          if (!seen.has(account.id)) {
            seen.add(account.id);
            accounts.push(account);
          }
        }
        this.exportCount.set(accounts.length);
        if (page.length < 80) break;
        const nextMaxId = page.at(-1)?.id;
        if (!nextMaxId || nextMaxId === maxId) throw new Error('Pagination did not advance.');
        maxId = nextMaxId;
      }
      saveCsv(followingAccountsCsv(accounts), 'following_accounts.csv');
    } catch {
      this.exportError.set('Could not export every friend. Please try again.');
    } finally {
      this.exportingFriends.set(false);
    }
  }
}
