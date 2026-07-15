import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AccountHoverCard } from '../account-hover-card/account-hover-card';
import { AccountListDialog, AccountListMode } from '../account-list-dialog/account-list-dialog';
import { Api } from '../api';
import { Auth } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { Compose } from '../compose/compose';
import { HistoryDialog } from '../history-dialog/history-dialog';
import { Lightbox } from '../lightbox/lightbox';
import { Poll, Status, Translation } from '../models';
import { PROVIDER_CAPS, ProviderCapabilities } from '../providers/provider';
import { BskyReply } from '../providers/bluesky/bluesky-reply';
import { StatusActions } from '../providers/status-actions';
import { ReportDialog } from '../report-dialog/report-dialog';
import { HumanTimePipe } from '../human-time.pipe';
import { VerifiedBadge } from '../verified-badge/verified-badge';

const QUOTE_POLICIES = ['public', 'followers', 'nobody'] as const;

@Component({
  selector: 'app-status-card',
  imports: [
    RouterLink,
    AccountHoverCard,
    ReportDialog,
    AccountListDialog,
    HistoryDialog,
    FormsModule,
    Compose,
    BskyReply,
    HumanTimePipe,
    Lightbox,
    VerifiedBadge,
  ],
  templateUrl: './status-card.html',
  styleUrl: './status-card.css',
})
export class StatusCard {
  private api = inject(Api);
  private auth = inject(Auth);
  private prefs = inject(ClientPrefs);
  private actions = inject(StatusActions);

  /** Pictures render only when images are on and feed reader mode is off. */
  protected imagesVisible = computed(() => this.prefs.showImages() && !this.prefs.feedReader());

  readonly status = input.required<Status>();
  readonly changed = output<Status>();
  /** Emitted when the user deletes this status, so containers can drop it. */
  readonly deleted = output<Status>();
  /** Emitted with the newly-created reply when the user replies inline. */
  readonly replied = output<Status>();

  // Inline composers (reply / quote), shown beneath the status when toggled.
  protected replying = signal(false);
  protected quoting = signal(false);

  protected readonly quotePolicies = QUOTE_POLICIES;

  protected showReport = signal(false);
  protected reported = signal(false);

  protected editing = signal(false);
  protected editText = signal('');
  protected saving = signal(false);

  // Translation: held locally; null means "showing original".
  protected translation = signal<Translation | null>(null);
  protected translating = signal(false);

  // Poll voting state (selected option positions before submitting).
  protected pollSelection = signal<number[]>([]);

  // Dialogs.
  protected accountListMode = signal<AccountListMode | null>(null);
  protected showHistory = signal(false);
  protected showPolicyMenu = signal(false);

  // Image lightbox: the index of the attachment being viewed, or null when closed.
  protected lightboxIndex = signal<number | null>(null);

  /** Whether the logged-in user owns the displayed status (can edit/delete). */
  protected isOwn = computed(() => this.display.account.id === this.auth.account()?.id);

  /** True when this status quotes one of the viewer's own statuses (revocable). */
  protected canRevokeQuote = computed(() => {
    const q = this.display.quote?.quoted_status;
    return (
      !!q && q.account.id === this.auth.account()?.id && this.display.quote?.state === 'accepted'
    );
  });

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

  // --- delete & repost ---
  protected redrafting = signal(false);
  protected redraftText = signal('');

  /**
   * Delete the post on the server, then reopen its source text in an inline
   * composer so it can be tweaked and reposted (Blue's "edit", the honest way).
   */
  deleteAndRedraft(event: Event): void {
    event.stopPropagation();
    if (!confirm('Delete this post and re-draft it?')) {
      return;
    }
    this.api.getStatusSource(this.display.id).subscribe((src) => {
      this.api.deleteStatus(this.display.id).subscribe(() => {
        this.redraftText.set(src.text);
        this.redrafting.set(true);
      });
    });
  }

  /** The redraft was posted: swap the (already deleted) original for the new status. */
  onRedrafted(status: Status): void {
    this.redrafting.set(false);
    this.changed.emit(status);
  }

  /** Redraft abandoned: the original is gone from the server, so drop the card. */
  cancelRedraft(): void {
    this.redrafting.set(false);
    this.deleted.emit(this.status());
  }

  /** Open the image lightbox at the clicked attachment. */
  openLightbox(index: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.lightboxIndex.set(index);
  }

  /**
   * Intercept clicks inside rendered post HTML: if the user clicked a link
   * that points off-site, open it in a new tab instead of letting the
   * surrounding router link swallow the navigation.
   */
  onContentClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute('href');
    if (!href) {
      return;
    }
    // Treat anything with an explicit http(s) origin as external.
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  /** The status to render: unwrap a boost to the original. */
  get display(): Status {
    const s = this.status();
    return s.reblog ?? s;
  }

  /**
   * True for posts from a foreign provider (RSS, Bluesky, …). Foreign posts
   * have no server-side account/thread to link to, and their interactions are
   * capability-gated — RSS is read-only, so it gets "Open original" instead.
   */
  protected get foreign(): boolean {
    return (this.display.provider ?? 'mastodon') !== 'mastodon';
  }

  protected get providerBadge(): string | null {
    switch (this.display.provider) {
      case 'rss':
        return '📡 RSS';
      case 'bluesky':
        return '🦋 Bluesky';
      default:
        return null;
    }
  }

  /** Which interactions this post's network supports (buttons hide per provider). */
  protected get caps(): ProviderCapabilities {
    return PROVIDER_CAPS[this.display.provider ?? 'mastodon'];
  }

  get boostedBy(): string | null {
    const s = this.status();
    return s.reblog ? s.account.display_name : null;
  }

  /** The quoted status to embed, if this status quotes a visible one. */
  protected quotedStatus = computed<Status | null>(() => this.display.quote?.quoted_status ?? null);

  /** True when a quote exists but the quoted status is hidden (e.g. revoked). */
  protected quoteUnavailable = computed<boolean>(() => {
    const q = this.display.quote;
    return !!q && q.quoted_status === null;
  });

  // --- inline reply / quote ---
  toggleReply(event: Event): void {
    event.stopPropagation();
    this.quoting.set(false);
    this.replying.update((v) => !v);
  }

  toggleQuote(event: Event): void {
    event.stopPropagation();
    this.replying.set(false);
    this.quoting.update((v) => !v);
  }

  /** A reply was posted: bump the local count and bubble it up to the container. */
  onReplied(reply: Status): void {
    this.replying.set(false);
    this.changed.emit({ ...this.display, replies_count: this.display.replies_count + 1 });
    this.replied.emit(reply);
  }

  /** A quote post was created: surface it to the container like a reply. */
  onQuoted(quote: Status): void {
    this.quoting.set(false);
    this.replied.emit(quote);
  }

  toggleFavourite(event: Event): void {
    event.stopPropagation();
    // Routed by provider (Mastodon API vs Bluesky like records).
    this.actions.toggleFavourite(this.display).subscribe((updated) => this.changed.emit(updated));
  }

  toggleReblog(event: Event): void {
    event.stopPropagation();
    this.actions
      .toggleReblog(this.display)
      .subscribe((updated) => this.changed.emit(updated.reblog ?? updated));
  }

  toggleBookmark(event: Event): void {
    event.stopPropagation();
    const s = this.display;
    const call = s.bookmarked ? this.api.unbookmark(s.id) : this.api.bookmark(s.id);
    call.subscribe((updated) => this.changed.emit(updated));
  }

  togglePin(event: Event): void {
    event.stopPropagation();
    const s = this.display;
    const call = s.pinned ? this.api.unpin(s.id) : this.api.pin(s.id);
    call.subscribe((updated) => this.changed.emit(updated));
  }

  toggleMute(event: Event): void {
    event.stopPropagation();
    const s = this.display;
    const call = s.muted ? this.api.unmuteStatus(s.id) : this.api.muteStatus(s.id);
    call.subscribe((updated) => this.changed.emit(updated));
  }

  // --- translation ---
  toggleTranslate(event: Event): void {
    event.stopPropagation();
    if (this.translation()) {
      this.translation.set(null);
      return;
    }
    this.translating.set(true);
    this.api.translate(this.display.id).subscribe({
      next: (t) => {
        this.translation.set(t);
        this.translating.set(false);
      },
      error: () => this.translating.set(false),
    });
  }

  // --- polls ---
  protected poll = computed<Poll | null>(() => this.display.poll);

  protected pollClosed = computed<boolean>(() => {
    const p = this.poll();
    return !p || p.expired || p.voted;
  });

  pollPercent(option: { votes_count: number }): number {
    const total = this.poll()?.votes_count ?? 0;
    return total === 0 ? 0 : Math.round((option.votes_count / total) * 100);
  }

  toggleChoice(position: number): void {
    const p = this.poll();
    if (!p) {
      return;
    }
    if (p.multiple) {
      this.pollSelection.update((sel) =>
        sel.includes(position) ? sel.filter((x) => x !== position) : [...sel, position],
      );
    } else {
      this.pollSelection.set([position]);
    }
  }

  submitVote(event: Event): void {
    event.stopPropagation();
    const p = this.poll();
    if (!p || !this.pollSelection().length) {
      return;
    }
    this.api.votePoll(p.id, this.pollSelection()).subscribe((updated) => {
      // Reflect the updated poll back onto the status for re-render.
      this.changed.emit({ ...this.display, poll: updated });
      this.pollSelection.set([]);
    });
  }

  // --- favourited/reblogged-by dialogs ---
  openAccountList(mode: AccountListMode, event: Event): void {
    event.stopPropagation();
    this.accountListMode.set(mode);
  }

  // --- edit history ---
  openHistory(event: Event): void {
    event.stopPropagation();
    this.showHistory.set(true);
  }

  // --- interaction policy / quote revoke ---
  togglePolicyMenu(event: Event): void {
    event.stopPropagation();
    this.showPolicyMenu.update((v) => !v);
  }

  setPolicy(policy: string): void {
    this.api.setInteractionPolicy(this.display.id, policy).subscribe((updated) => {
      this.changed.emit(updated);
      this.showPolicyMenu.set(false);
    });
  }

  revokeQuote(event: Event): void {
    event.stopPropagation();
    const quoted = this.display.quote?.quoted_status;
    if (!quoted) {
      return;
    }
    // The viewer owns the quoted status; revoke this status's quote of it.
    this.api
      .revokeQuote(quoted.id, this.display.id)
      .subscribe((updated) => this.changed.emit(updated));
  }
}
