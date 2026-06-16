import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../api';
import { Auth } from '../auth';
import { Status } from '../models';
import { ReportDialog } from '../report-dialog/report-dialog';

@Component({
  selector: 'app-status-card',
  imports: [RouterLink, ReportDialog, FormsModule],
  templateUrl: './status-card.html',
  styleUrl: './status-card.css',
})
export class StatusCard {
  private api = inject(Api);
  private auth = inject(Auth);

  readonly status = input.required<Status>();
  readonly changed = output<Status>();
  /** Emitted when the user deletes this status, so containers can drop it. */
  readonly deleted = output<Status>();

  protected showReport = signal(false);
  protected reported = signal(false);

  protected editing = signal(false);
  protected editText = signal('');
  protected saving = signal(false);

  /** Whether the logged-in user owns the displayed status (can edit/delete). */
  protected isOwn = computed(() => this.display.account.id === this.auth.account()?.id);

  openReport(event: Event): void {
    event.stopPropagation();
    this.showReport.set(true);
  }

  onReported(): void {
    this.showReport.set(false);
    this.reported.set(true);
  }

  startEdit(event: Event): void {
    event.stopPropagation();
    this.api.getStatusSource(this.display.id).subscribe((src) => {
      this.editText.set(src.text);
      this.editing.set(true);
    });
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  saveEdit(): void {
    const text = this.editText().trim();
    if (!text || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.api.editStatus(this.display.id, text).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.editing.set(false);
        this.changed.emit(updated);
      },
      error: () => this.saving.set(false),
    });
  }

  remove(event: Event): void {
    event.stopPropagation();
    if (!confirm('Delete this post?')) {
      return;
    }
    this.api.deleteStatus(this.display.id).subscribe(() => this.deleted.emit(this.status()));
  }

  /** The status to render: unwrap a boost to the original. */
  get display(): Status {
    const s = this.status();
    return s.reblog ?? s;
  }

  get boostedBy(): string | null {
    const s = this.status();
    return s.reblog ? s.account.display_name : null;
  }

  toggleFavourite(event: Event): void {
    event.stopPropagation();
    const s = this.display;
    const call = s.favourited ? this.api.unfavourite(s.id) : this.api.favourite(s.id);
    call.subscribe((updated) => this.changed.emit(updated));
  }

  toggleReblog(event: Event): void {
    event.stopPropagation();
    const s = this.display;
    const call = s.reblogged ? this.api.unreblog(s.id) : this.api.reblog(s.id);
    call.subscribe((updated) => this.changed.emit(updated.reblog ?? updated));
  }

  toggleBookmark(event: Event): void {
    event.stopPropagation();
    const s = this.display;
    const call = s.bookmarked ? this.api.unbookmark(s.id) : this.api.bookmark(s.id);
    call.subscribe((updated) => this.changed.emit(updated));
  }
}
