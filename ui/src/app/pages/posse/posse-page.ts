import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HugoSettings } from '../../providers/hugo/hugo-settings';
import { PossePublish } from '../../providers/hugo/posse-publish';
import { PosseEntry, PosseQueue } from '../../providers/hugo/posse-queue';
import { DeliveryState, WebmentionSend } from '../../providers/hugo/webmention-send';

/** One target's outcome, for the results list under the queue. */
interface DeliveryReport {
  targetUrl: string;
  targetAuthor: string;
  state: DeliveryState;
  endpoint: string | null;
  message: string;
}

/**
 * The POSSE queue — interactions waiting to be recorded on your own site.
 *
 * A page you *act on* rather than one you configure, which is why it lives at
 * `/posse` in the main routes rather than under settings. The badge in the
 * shell is what makes sure nothing sits here forgotten.
 */
@Component({
  selector: 'app-posse-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './posse-page.html',
  styleUrl: './posse-page.css',
})
export class PossePage {
  protected readonly queue = inject(PosseQueue);
  protected readonly settings = inject(HugoSettings);
  private readonly publisher = inject(PossePublish);
  private readonly sender = inject(WebmentionSend);

  protected readonly publishing = signal(false);
  protected readonly notifying = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** What happened when each target's site was notified, after a publish. */
  protected readonly deliveries = signal<DeliveryReport[]>([]);

  /**
   * Whether any delivery actually reached anyone.
   *
   * Used only to decide whether the results are worth a heading. Most batches
   * will be entirely `no-endpoint` — that is the expected shape, not a problem.
   */
  protected readonly anyDelivered = computed(() =>
    this.deliveries().some((report) => report.state === 'delivered'),
  );

  /** Newest first — the most recent thing you did is the most recognisable. */
  protected readonly entries = computed(() =>
    [...this.queue.entries()].sort((a, b) => b.queuedAt.localeCompare(a.queuedAt)),
  );

  protected readonly canPublish = computed(
    () => !this.queue.isEmpty() && this.settings.connected() && !this.publishing(),
  );

  protected label(entry: PosseEntry): string {
    switch (entry.kind) {
      case 'like':
        return 'Liked';
      case 'repost':
        return 'Boosted';
      case 'reply':
        return 'Replied to';
    }
  }

  protected icon(entry: PosseEntry): string {
    switch (entry.kind) {
      case 'like':
        return '★';
      case 'repost':
        return '🔁';
      case 'reply':
        return '💬';
    }
  }

  async publishAll(): Promise<void> {
    if (!this.canPublish()) {
      return;
    }
    this.publishing.set(true);
    this.notice.set(null);
    this.error.set(null);
    this.deliveries.set([]);
    // Snapshot before publishing: a successful publish clears the queue, and
    // these are what the delivery pass needs to iterate.
    const published = [...this.queue.entries()];
    try {
      const result = await this.publisher.publishAll();
      const count = result.publishedIds.length;
      this.notice.set(
        result.commitSha
          ? `Recorded ${count} interaction${count === 1 ? '' : 's'} to ${result.path}.`
          : `Those ${count} interaction${count === 1 ? '' : 's'} were already recorded.`,
      );
      // Published is the durable part and it is now done. Notifying the other
      // sites is a courtesy on top, and its failure never retracts any of that.
      await this.notifyTargets(published, result.sourceUrls);
    } catch (error: unknown) {
      this.error.set(
        error instanceof Error ? error.message : "Couldn't record these to your blog.",
      );
    } finally {
      this.publishing.set(false);
    }
  }

  /**
   * Tell each target's site, where there is a site that can be told.
   *
   * Deliberately sequential and one attempt each: a webmention is a courtesy
   * notification, and a client that fires them in parallel with retries is a
   * client that hammers strangers' endpoints.
   *
   * Most results will be `no-endpoint`, which is correct rather than a failure
   * — see `WebmentionSend`. The UI styles it neutrally for exactly that reason.
   */
  private async notifyTargets(
    entries: readonly PosseEntry[],
    sourceUrls: Record<string, string>,
  ): Promise<void> {
    if (!entries.length) {
      return;
    }
    this.sender.resetCache();
    this.notifying.set(true);
    try {
      for (const entry of entries) {
        const source = sourceUrls[entry.id];
        if (!source) {
          // No site URL configured, so there is no page to point a receiver at.
          continue;
        }
        const result = await this.sender.send(entry.targetUrl, source);
        this.deliveries.update((list) => [
          ...list,
          { targetUrl: entry.targetUrl, targetAuthor: entry.targetAuthor, ...result },
        ]);
      }
    } finally {
      this.notifying.set(false);
    }
  }

  remove(entry: PosseEntry): void {
    this.queue.remove(entry.id);
  }
}
