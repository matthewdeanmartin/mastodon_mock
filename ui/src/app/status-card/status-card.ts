import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccountHoverCard } from '../account-hover-card/account-hover-card';
import { AccountListDialog, AccountListMode } from '../account-list-dialog/account-list-dialog';
import { Api } from '../api';
import { Auth } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { Compose } from '../compose/compose';
import { HistoryDialog } from '../history-dialog/history-dialog';
import { Lightbox } from '../lightbox/lightbox';
import { applyMinimalMarkdown } from '../markdown';
import { FilterContext, FilterResult, Poll, Status, Translation } from '../models';
import { MutedPosts } from '../muted-posts';
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
  private router = inject(Router);
  private mutedPosts = inject(MutedPosts);

  /** Pictures render only when images are on and feed reader mode is off. */
  protected imagesVisible = computed(() => this.prefs.showImages() && !this.prefs.feedReader());

  /** ⭐ or ❤️, per the Mockingbird Blue preference. */
  protected favIcon = computed(() => (this.prefs.favStyle() === 'heart' ? '❤️' : '⭐'));

  /** The viewer hid this post ("mute this post"); renders as nothing. */
  protected mutedLocally = computed(() => {
    const map = this.mutedPosts.muted();
    const s = this.status();
    const shown = s.reblog ?? s;
    return (map[shown.id] ?? 0) > Date.now();
  });

  /** Minimal markdown (bold/italic/code/headers) applied to the body HTML. */
  protected md = applyMinimalMarkdown;

  readonly status = input.required<Status>();
  /**
   * Which timeline this card renders in — content filters are scoped per
   * context (a filter can apply to home but not threads, say).
   */
  readonly filterContext = input<FilterContext>('home');
  /** Thread view turns this on: show which app the post was made with. */
  readonly showSource = input(false);
  readonly changed = output<Status>();
  /** Emitted when the user deletes this status, so containers can drop it. */
  readonly deleted = output<Status>();
  /** Emitted with the newly-created reply when the user replies inline. */
  readonly replied = output<Status>();

  // Inline composers (reply / quote), shown beneath the status when toggled.
  protected replying = signal(false);
  protected quoting = signal(false);

  // --- content warnings ---

  /** CW revealed by the viewer; resets whenever a different status is bound. */
  protected cwOpen = linkedSignal({ source: this.status, computation: () => false });

  /** The CW label to show (a translation may carry its own spoiler text). */
  protected spoilerText = computed(
    () => this.translation()?.spoiler_text || this.display.spoiler_text,
  );

  /**
   * True while the body (text, media, poll, quote) hides behind the CW.
   * Reader mode means "I want to read it": CWs render pre-expanded.
   */
  protected cwCollapsed = computed(
    () => !!this.spoilerText() && !this.cwOpen() && !this.prefs.feedReader(),
  );

  toggleCw(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cwOpen.update((v) => !v);
  }

  // --- content filters (server-computed `filtered`, applied client-side) ---

  /** Matched filters that apply in this timeline's context. */
  private activeFilters = computed<FilterResult[]>(() => {
    const s = this.status();
    const results = s.reblog
      ? [...(s.filtered ?? []), ...(s.reblog.filtered ?? [])]
      : (s.filtered ?? []);
    return results.filter((r) => r.filter.context.includes(this.filterContext()));
  });

  /** A hide-action filter matched: the post renders as nothing at all. */
  protected hiddenByFilter = computed(() =>
    this.activeFilters().some((r) => r.filter.filter_action === 'hide'),
  );

  /** Viewer clicked "Show anyway" on a warn filter; resets per status. */
  protected filterOverridden = linkedSignal({ source: this.status, computation: () => false });

  /**
   * A warn-action filter matched and hasn't been overridden: show the stub.
   * Reader mode expands these too (hide-action filters still hide outright).
   */
  protected filterCollapsed = computed(
    () =>
      !this.hiddenByFilter() &&
      !this.filterOverridden() &&
      !this.prefs.feedReader() &&
      this.activeFilters().some((r) => r.filter.filter_action === 'warn'),
  );

  /** "Filtered: <titles>" label for the collapsed stub. */
  protected filterTitles = computed(() =>
    [
      ...new Set(
        this.activeFilters()
          .filter((r) => r.filter.filter_action === 'warn')
          .map((r) => r.filter.title),
      ),
    ].join(', '),
  );

  showFiltered(event: Event): void {
    event.stopPropagation();
    this.filterOverridden.set(true);
  }

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

  /**
   * Mastodon-compatible per-status shortcuts, active while the card is
   * focused (j/k in Hotkeys moves focus here). Handled keys stop propagating
   * so the global handler never doubles up.
   */
  onCardKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const target = event.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || target.isContentEditable) {
      return;
    }
    const key = event.key.toLowerCase();
    if (['a', 'button', 'label'].includes(tag) && key === 'enter') {
      return;
    }
    if (this.handleCardKey(key, event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private handleCardKey(key: string, event: Event): boolean {
    switch (key) {
      case 'f':
        if (this.caps.favourite) {
          this.toggleFavourite(event);
        }
        return true;
      case 'b':
        if (this.caps.reblog) {
          this.toggleReblog(event);
        }
        return true;
      case 'r':
      case 'm':
        if (this.caps.reply) {
          this.toggleReply(event);
        }
        return true;
      case 'q':
        if (!this.foreign) {
          this.toggleQuote(event);
        }
        return true;
      case 'enter':
      case 'o':
        if (this.threadable) {
          void this.router.navigate(['/statuses', this.display.id]);
        }
        return true;
      case 'p':
        if (!this.foreign) {
          void this.router.navigate(['/accounts', this.display.account.id]);
        }
        return true;
      case 'e':
        if (this.display.media_attachments?.length) {
          this.lightboxIndex.set(0);
        }
        return true;
      case 'x':
        // Mastodon's shortcut: toggle the content-warning fold.
        if (this.spoilerText()) {
          this.cwOpen.update((v) => !v);
        }
        return true;
      default:
        return false;
    }
  }

  openReport(event: Event): void {
    event.stopPropagation();
    this.showReport.set(true);
  }

  onReported(): void {
    this.showReport.set(false);
    this.reported.set(true);
  }

  /** Mute duration presets for the ••• menu (seconds; null = indefinite). */
  protected readonly muteDurations: { label: string; seconds: number | null }[] = [
    { label: '1 hour', seconds: 3600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: 'forever', seconds: null },
  ];

  /** Set once the viewer mutes the author from this card (flips the menu row). */
  protected mutedAuthor = signal(false);

  muteAuthor(event: Event, seconds: number | null): void {
    event.stopPropagation();
    this.api.muteAccount(this.display.account.id, seconds ?? undefined).subscribe({
      next: () => this.mutedAuthor.set(true),
      error: () => this.actionError.set('Could not mute this account.'),
    });
  }

  /** Hide this post locally for 30 days (there is no server-side per-post hide). */
  mutePost(event: Event): void {
    event.stopPropagation();
    this.mutedPosts.mute(this.display.id);
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
    // Hashtag links in server-rendered content point at the origin instance
    // (e.g. https://mastodon.social/tags/foo). Keep them in-app: route to
    // Mockingbird's own tag page instead of opening the instance.
    const tag = this.hashtagName(anchor, href);
    if (tag) {
      event.preventDefault();
      event.stopPropagation();
      this.router.navigate(['/tags', tag]);
      return;
    }
    // Treat anything else with an explicit http(s) origin as external.
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Extract a hashtag name from a content anchor, or null if it isn't one.
   * Mastodon marks these with `class="… hashtag"` and an href ending in
   * `/tags/<name>`; we fall back to the anchor's visible `#text`.
   */
  private hashtagName(anchor: HTMLAnchorElement, href: string): string | null {
    const isHashtag = anchor.classList.contains('hashtag') || /\/tags?\/[^/?#]+\/?$/i.test(href);
    if (!isHashtag) {
      return null;
    }
    const fromHref = href.match(/\/tags?\/([^/?#]+)\/?$/i)?.[1];
    const raw = fromHref ?? anchor.textContent ?? '';
    const name = decodeURIComponent(raw).replace(/^#/, '').trim();
    return name || null;
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

  /**
   * True when the thread page can render this post's conversation. Bluesky
   * threads load via `getPostThread`; RSS items have no thread at all.
   */
  protected get threadable(): boolean {
    const provider = this.display.provider ?? 'mastodon';
    return provider === 'mastodon' || provider === 'bluesky';
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

  /** An action (fav/boost) is in flight; the button is disabled meanwhile. */
  protected actionBusy = signal(false);
  /** Last fav/boost failure, shown under the actions row until the next attempt. */
  protected actionError = signal<string | null>(null);

  toggleFavourite(event: Event): void {
    event.stopPropagation();
    // Routed by provider (Mastodon API vs Bluesky like records). Foreign calls
    // cross the network to another service, so show pending + surface failures
    // (a silently dead Bluesky session used to make this button "do nothing").
    this.actionBusy.set(true);
    this.actionError.set(null);
    this.actions.toggleFavourite(this.display).subscribe({
      next: (updated) => {
        this.actionBusy.set(false);
        this.changed.emit(updated);
      },
      error: () => {
        this.actionBusy.set(false);
        this.actionError.set(this.actionFailureMessage('like'));
      },
    });
  }

  toggleReblog(event: Event): void {
    event.stopPropagation();
    this.actionBusy.set(true);
    this.actionError.set(null);
    this.actions.toggleReblog(this.display).subscribe({
      next: (updated) => {
        this.actionBusy.set(false);
        this.changed.emit(updated.reblog ?? updated);
      },
      error: () => {
        this.actionBusy.set(false);
        this.actionError.set(this.actionFailureMessage('boost'));
      },
    });
  }

  private actionFailureMessage(verb: string): string {
    return this.display.provider === 'bluesky'
      ? `Couldn't ${verb} on Bluesky — your link may have expired. Re-link in Settings → Connections.`
      : `Couldn't ${verb} — try again.`;
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
