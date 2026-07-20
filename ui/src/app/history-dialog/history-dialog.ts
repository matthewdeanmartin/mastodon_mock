import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { Api } from '../api';
import { StatusEdit } from '../models';
import { AnonymousPublicApi } from '../providers/anonymous/anonymous-public-api';

/** A modal showing the edit-history snapshots of a status. */
@Component({
  selector: 'app-history-dialog',
  imports: [],
  templateUrl: './history-dialog.html',
  styleUrl: './history-dialog.css',
})
export class HistoryDialog implements OnInit {
  private api = inject(Api);
  private anonymousApi = inject(AnonymousPublicApi);

  readonly statusId = input.required<string>();
  readonly server = input<string | null>(null);
  readonly closed = output<void>();

  protected edits = signal<StatusEdit[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    const request = this.server()
      ? this.anonymousApi.getStatusHistory({ server: this.server()!, id: this.statusId() })
      : this.api.statusHistory(this.statusId());
    request.subscribe({
      next: (edits) => {
        this.edits.set(edits);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
