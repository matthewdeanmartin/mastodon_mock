import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../../api';
import { ConfirmDialog } from '../../confirm-dialog/confirm-dialog';
import { Draft, Drafts } from '../../drafts';
import { HumanTimePipe } from '../../human-time.pipe';
import { ScheduledStatus } from '../../models';
import { Auth } from '../../auth';

/**
 * The saved-drafts list plus the account's scheduled posts. Drafts live only
 * in this browser's localStorage — Mastodon has no server-side drafts — so
 * they don't follow you across devices. Scheduled posts DO live server-side
 * (`/api/v1/scheduled_statuses`); cancelling one deletes it on the server.
 * "Continue" opens a draft in the home composer.
 */
@Component({
  selector: 'app-drafts-page',
  imports: [ConfirmDialog, HumanTimePipe],
  templateUrl: './drafts-page.html',
  styleUrl: './drafts-page.css',
})
export class DraftsPage implements OnInit {
  protected drafts = inject(Drafts);
  private api = inject(Api);
  private router = inject(Router);
  protected auth = inject(Auth);

  protected pendingDelete = signal<Draft | null>(null);

  protected scheduled = signal<ScheduledStatus[]>([]);
  protected scheduledLoaded = signal(false);
  protected pendingCancel = signal<ScheduledStatus | null>(null);

  ngOnInit(): void {
    if (this.auth.isAnonymous) {
      this.scheduledLoaded.set(true);
      return;
    }
    this.api.scheduledStatuses().subscribe({
      next: (rows) => {
        this.scheduled.set(rows);
        this.scheduledLoaded.set(true);
      },
      error: () => this.scheduledLoaded.set(true),
    });
  }

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

  confirmCancel(): void {
    const sched = this.pendingCancel();
    this.pendingCancel.set(null);
    if (!sched) {
      return;
    }
    this.api.cancelScheduledStatus(sched.id).subscribe({
      next: () => this.scheduled.update((list) => list.filter((s) => s.id !== sched.id)),
    });
  }

  scheduledPreview(s: ScheduledStatus): string {
    const text = s.params.text ?? '';
    if (text.trim()) {
      return text.length > 140 ? text.slice(0, 140) + '…' : text;
    }
    return s.media_attachments.length ? '(media post)' : '(empty post)';
  }

  scheduledWhen(s: ScheduledStatus): string {
    return new Date(s.scheduled_at).toLocaleString();
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
      out.push(draft.target === 'paste' ? 'Title' : 'CW');
    }
    if (draft.target === 'paste') out.push(`📋 ${draft.pasteProviderId ?? 'paste'}`);
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
