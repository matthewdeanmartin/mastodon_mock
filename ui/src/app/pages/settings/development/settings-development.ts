import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../../api';
import { AuthorizedApp } from '../../../models';

/** Development: applications authorized against this account. */
@Component({
  selector: 'app-settings-development',
  imports: [],
  templateUrl: './settings-development.html',
  styleUrl: './settings-development.css',
})
export class SettingsDevelopment implements OnInit {
  private api = inject(Api);

  protected apps = signal<AuthorizedApp[]>([]);
  protected loading = signal(true);

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
