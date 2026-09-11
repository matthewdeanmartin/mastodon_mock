import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../api';

const CATEGORIES = ['spam', 'violation', 'other'] as const;

@Component({
  selector: 'app-report-dialog',
  imports: [FormsModule],
  templateUrl: './report-dialog.html',
  styleUrl: './report-dialog.css',
})
export class ReportDialog {
  private api = inject(Api);

  /** Username shown in the heading. */
  readonly username = input.required<string>();
  readonly accountId = input.required<string>();
  /** Optional status being reported (a "report this post" flow). */
  readonly statusId = input<string | undefined>(undefined);

  readonly closed = output<void>();
  readonly submitted = output<void>();

  protected readonly categories = CATEGORIES;
  protected category = signal<string>('spam');
  protected comment = signal('');
  protected submitting = signal(false);

  submit(): void {
    if (this.submitting()) {
      return;
    }
    this.submitting.set(true);
    const statusIds = this.statusId() ? [this.statusId()!] : undefined;
    this.api.report(this.accountId(), this.category(), this.comment(), statusIds).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.emit();
      },
      error: () => this.submitting.set(false),
    });
  }
}
