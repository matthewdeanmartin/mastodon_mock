import { Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../api';
import { Status } from '../models';
import { ReportDialog } from '../report-dialog/report-dialog';

@Component({
  selector: 'app-status-card',
  imports: [RouterLink, ReportDialog],
  templateUrl: './status-card.html',
  styleUrl: './status-card.css',
})
export class StatusCard {
  private api = inject(Api);

  readonly status = input.required<Status>();
  readonly changed = output<Status>();

  protected showReport = signal(false);
  protected reported = signal(false);

  openReport(event: Event): void {
    event.stopPropagation();
    this.showReport.set(true);
  }

  onReported(): void {
    this.showReport.set(false);
    this.reported.set(true);
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
