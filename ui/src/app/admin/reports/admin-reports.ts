import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApi } from '../admin-api';
import { AdminReport } from '../../models';

@Component({
  selector: 'app-admin-reports',
  imports: [RouterLink],
  templateUrl: './admin-reports.html',
  styleUrl: './admin-reports.css',
})
export class AdminReports implements OnInit {
  private api = inject(AdminApi);

  protected resolved = signal(false);
  protected reports = signal<AdminReport[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  setResolved(resolved: boolean): void {
    if (this.resolved() === resolved) {
      return;
    }
    this.resolved.set(resolved);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.reports(this.resolved()).subscribe({
      next: (r) => {
        this.reports.set(r);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** A report leaves the current tab once resolved/reopened, so just drop it. */
  private remove(id: string): void {
    this.reports.update((list) => list.filter((r) => r.id !== id));
  }

  private replace(updated: AdminReport): void {
    this.reports.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
  }

  assign(r: AdminReport): void {
    this.api.assignReport(r.id).subscribe((u) => this.replace(u));
  }

  resolve(r: AdminReport): void {
    this.api.resolveReport(r.id).subscribe(() => this.remove(r.id));
  }

  reopen(r: AdminReport): void {
    this.api.reopenReport(r.id).subscribe(() => this.remove(r.id));
  }
}
