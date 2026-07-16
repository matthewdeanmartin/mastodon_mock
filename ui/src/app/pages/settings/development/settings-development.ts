import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../../api';
import { BugReportDialog } from '../../../bug-report-dialog/bug-report-dialog';
import { AuthorizedApp } from '../../../models';

/** Development: applications authorized against this account, plus bug reporting. */
@Component({
  selector: 'app-settings-development',
  imports: [BugReportDialog],
  templateUrl: './settings-development.html',
  styleUrl: './settings-development.css',
})
export class SettingsDevelopment implements OnInit {
  private api = inject(Api);

  protected apps = signal<AuthorizedApp[]>([]);
  protected loading = signal(true);

  /** Whether the "Report a bug" dialog is open. */
  protected reporting = signal(false);

  ngOnInit(): void {
    this.api.authorizedApps().subscribe({
      next: (apps) => {
        this.apps.set(apps);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected formatDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : 'Never used';
  }
}
