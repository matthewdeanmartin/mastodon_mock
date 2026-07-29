import { Component, HostListener, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  GradedQuery,
  SEARCH_SUCCESS_THRESHOLD,
  SearchHelper,
  SearchHelperResult,
} from '../search-helper';

/**
 * "Describe what you're looking for" → a runnable Mastodon query.
 *
 * The dialog never runs a search itself. It hands a query back to the search
 * page, pre-filled into a textarea the user can edit first — the model
 * proposes, the user decides. That is the same shape as the tag helper, and it
 * is deliberate: nothing an LLM produces here takes effect without a human
 * reading it.
 */
@Component({
  selector: 'app-search-helper-dialog',
  imports: [FormsModule],
  templateUrl: './search-helper-dialog.html',
  styleUrl: './search-helper-dialog.css',
})
export class SearchHelperDialog {
  private helper = inject(SearchHelper);

  /** The chosen query. The page fills its search box and runs the normal path. */
  readonly useQuery = output<string>();
  readonly closed = output<void>();

  protected readonly threshold = SEARCH_SUCCESS_THRESHOLD;

  protected request = signal('');
  protected busy = signal(false);
  protected error = signal<string | null>(null);
  protected result = signal<SearchHelperResult | null>(null);
  /** The editable query. Seeded from the winner, then owned by the user. */
  protected draft = signal('');

  async ask(): Promise<void> {
    const request = this.request().trim();
    if (!request || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      const result = await this.helper.run(request);
      this.result.set(result);
      // Seed with whatever worked; failing that, the model's best guess, so the
      // user always has something to edit rather than an empty box.
      this.draft.set(result.winner ?? result.queries[0] ?? '');
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : "Couldn't reach the model.");
    } finally {
      this.busy.set(false);
    }
  }

  /** Put a specific candidate in the editor without running anything. */
  pick(query: string): void {
    this.draft.set(query);
  }

  /**
   * What happened to one suggestion, or undefined when it was never tried.
   *
   * Every suggestion is listed, not just the tried ones: short-circuiting saves
   * API calls, but the untried candidates are still the model's suggestions and
   * are often what you actually want. "Not tried" is a state, not a reason to
   * hide something.
   */
  protected attemptFor(result: SearchHelperResult, query: string): GradedQuery | undefined {
    return result.attempts.find((attempt) => attempt.query === query);
  }

  use(): void {
    const query = this.draft().trim();
    if (query) {
      this.useQuery.emit(query);
    }
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }

  /** "3 results" / "no results" / "search failed" / "not tried" for one suggestion. */
  protected outcomeLabel(attempt: GradedQuery | undefined): string {
    if (!attempt) {
      return 'not tried';
    }
    if (attempt.count === null) {
      return 'search failed';
    }
    if (attempt.count === 0) {
      return 'no results';
    }
    return `${attempt.count} result${attempt.count === 1 ? '' : 's'}`;
  }

  /** The one-line summary above the editor. */
  protected summary(result: SearchHelperResult): string {
    const calls = `${result.callsUsed} search${result.callsUsed === 1 ? '' : 'es'}`;
    if (!result.winner) {
      return `Nothing returned ${this.threshold}+ results, even after rewriting. Edit the best guess below — ${calls} tried.`;
    }
    const position = result.attempts.length;
    const which = position === 1 ? 'The first suggestion worked' : `Suggestion ${position} worked`;
    const rewritten = result.refined ? ', after one rewrite' : '';
    return `${which}${rewritten} — ${calls} tried.`;
  }
}
