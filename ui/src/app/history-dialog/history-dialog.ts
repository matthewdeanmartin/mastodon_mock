import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { Api } from '../api';
import { StatusEdit } from '../models';

/** A modal showing the edit-history snapshots of a status. */
@Component({
  selector: 'app-history-dialog',
  imports: [],
  templateUrl: './history-dialog.html',
  styleUrl: './history-dialog.css',
})
export class HistoryDialog implements OnInit {
  private api = inject(Api);

  readonly statusId = input.required<string>();
  readonly closed = output<void>();

  protected edits = signal<StatusEdit[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.api.statusHistory(this.statusId()).subscribe({
      next: (edits) => {
        this.edits.set(edits);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
