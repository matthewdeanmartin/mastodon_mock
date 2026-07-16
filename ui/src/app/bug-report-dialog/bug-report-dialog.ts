import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BugReport } from '../bug-report';
import { ErrorLog } from '../error-log';

/**
 * "Report a bug" dialog. It assembles a Markdown report — the user's
 * description plus build/env details and (optionally) the recent in-app errors
 * — and hands it off two ways: copy to clipboard, or open a prefilled GitHub
 * issue in a new tab. Nothing is ever sent automatically; the user always does
 * the final submit on GitHub. The technical details are shown in full before
 * anything leaves, and the recent-errors section is opt-out.
 */
@Component({
  selector: 'app-bug-report-dialog',
  imports: [FormsModule],
  templateUrl: './bug-report-dialog.html',
  styleUrl: './bug-report-dialog.css',
})
export class BugReportDialog {
  private readonly report = inject(BugReport);
  protected readonly errorLog = inject(ErrorLog);

  readonly closed = output<void>();

  protected description = signal('');
  protected includeErrors = signal(true);
  protected showDetails = signal(false);
  protected copied = signal(false);

  protected readonly hasErrors = computed(() => this.errorLog.entries().length > 0);

  /** Live preview of the exact Markdown that will be copied / filed. */
  protected readonly preview = computed(() =>
    this.report.buildMarkdown({
      description: this.description(),
      includeErrors: this.includeErrors(),
    }),
  );

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.preview());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions, insecure context). The GitHub
      // button still works, and the preview text is selectable by hand.
      this.copied.set(false);
    }
  }

  openGithub(): void {
    const url = this.report.buildGithubUrl({
      description: this.description(),
      includeErrors: this.includeErrors(),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
