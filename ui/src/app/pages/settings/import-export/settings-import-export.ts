import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { ImportReport } from '../../../models';

type CsvKind = 'following' | 'mutes' | 'blocks';

/** CSV export/import of follows, mutes, and blocks. */
@Component({
  selector: 'app-settings-import-export',
  imports: [FormsModule],
  templateUrl: './settings-import-export.html',
})
export class SettingsImportExport {
  private api = inject(Api);

  protected importKind = signal<CsvKind>('following');
  protected csvText = signal('');
  protected uploading = signal(false);
  protected report = signal<ImportReport | null>(null);

  protected download(kind: CsvKind): void {
    this.api.exportCsv(kind).subscribe((csv) => {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  protected onFile(event: Event): void {
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
}
