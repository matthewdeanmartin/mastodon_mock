import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmDialog } from '../../confirm-dialog/confirm-dialog';
import { Draft, Drafts } from '../../drafts';
import { HumanTimePipe } from '../../human-time.pipe';

/**
 * The saved-drafts list. Drafts live only in this browser's localStorage —
 * Mastodon has no server-side drafts — so they don't follow you across
 * devices. "Continue" opens the draft in the home composer.
 */
@Component({
  selector: 'app-drafts-page',
  imports: [ConfirmDialog, HumanTimePipe],
  templateUrl: './drafts-page.html',
  styleUrl: './drafts-page.css',
})
export class DraftsPage {
  protected drafts = inject(Drafts);
  private router = inject(Router);

  protected pendingDelete = signal<Draft | null>(null);

  open(draft: Draft): void {
    void this.router.navigate(['/home'], { queryParams: { draft: draft.id } });
  }

  confirmDelete(): void {
    const draft = this.pendingDelete();
    if (draft) {
      this.drafts.remove(draft.id);
    }
    this.pendingDelete.set(null);
  }

  preview(draft: Draft): string {
    const text = draft.segments.find((s) => s.trim()) ?? '';
    if (text) {
      return text.length > 140 ? text.slice(0, 140) + '…' : text;
    }
    return draft.poll ? '(poll draft)' : '(empty draft)';
  }

  badges(draft: Draft): string[] {
    const out: string[] = [];
    if (draft.segments.filter((s) => s.trim()).length > 1) {
      out.push(`🧵 thread of ${draft.segments.filter((s) => s.trim()).length}`);
    }
    if (draft.spoilerText) {
      out.push('CW');
    }
    if (draft.poll) {
      out.push('📊 poll');
    }
    if (draft.inReplyToId) {
      out.push('↩ reply');
    }
    if (draft.quotedStatusId) {
      out.push('❝ quote');
    }
    return out;
  }
}
