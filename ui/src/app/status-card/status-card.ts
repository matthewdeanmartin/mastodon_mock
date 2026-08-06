import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgOptimizedImage } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AccountHoverCard } from '../account-hover-card/account-hover-card';
import { AccountListDialog, AccountListMode } from '../account-list-dialog/account-list-dialog';
import { Api } from '../api';
import { Auth } from '../auth';
import { hashtagNameFrom } from '../rendered-html-links';
import { ClientPrefs } from '../client-prefs';
import { Terminology } from '../terminology';
import { Compose } from '../compose/compose';
import { HistoryDialog } from '../history-dialog/history-dialog';
import { Lightbox } from '../lightbox/lightbox';
import { applyMinimalMarkdown } from '../markdown';
import { FilterContext, FilterResult, MediaAttachment, Poll, Status, Translation } from '../models';
import { OpenRouterSession } from '../providers/openrouter/openrouter-session';
import { AiAvailability } from '../ai-availability';
import { AiTranslate, AiTranslation, languageName } from '../ai-translate';
import { TranslationPreference } from '../translation-preference';
import { ENGINE_LABELS, TranslationEngine, TranslationUsage } from '../translation-usage';
import { AutoTranslateEligibility } from '../trend-language-filter';
import { MutedPosts } from '../muted-posts';
import { LocalModeration } from '../local-moderation';
import { StatusVisibility } from '../status-visibility';
import { serverKnowsStatus, ProviderCapabilities } from '../providers/provider';
import { BskyReply } from '../providers/bluesky/bluesky-reply';
import { AnonymousCapabilities } from '../providers/anonymous/anonymous-capabilities';
import { AnonymousBookmarks } from '../providers/anonymous/anonymous-bookmarks';
import { toNitterUrl } from '../providers/twitter/nitter';
import { StatusActions } from '../providers/status-actions';
import { ReportDialog } from '../report-dialog/report-dialog';
import { HumanTimePipe } from '../human-time.pipe';
import { VerifiedBadge } from '../verified-badge/verified-badge';
import { AnonymousProviderRef } from '../providers/anonymous/anonymous-mastodon-provider';
import { AnonymousPublicApi } from '../providers/anonymous/anonymous-public-api';
import { isElizaId } from '../eliza/eliza-identity';
import { LocalCompose } from '../eliza/local-compose';
import { ShareDialog } from '../share-dialog/share-dialog';
import {
  BookmarkChoice,
  BookmarkProviderDialog,
} from '../bookmark-provider-dialog/bookmark-provider-dialog';
import { firstExternalLink, RaindropSession } from '../providers/raindrop/raindrop-session';
import { Server } from '../server';
import {
  anonymousAccountRouteRef,
  anonymousStatusRouteRef,
} from '../providers/anonymous/anonymous-route-ref';

const QUOTE_POLICIES = ['public', 'followers', 'nobody'] as const;

interface MastodonPostRef {
  url: string;
  server: string;
  id: string;
}

/** Recognise the public URL shapes emitted by Mastodon and compatible servers. */
function mastodonPostRef(content: string): MastodonPostRef | null {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    try {
      const url = new URL(anchor.href);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const id =
        url.pathname.match(/^\/@[^/]+\/(\d+)\/?$/)?.[1] ??
        url.pathname.match(/^\/users\/[^/]+\/statuses\/(\d+)\/?$/)?.[1] ??
        url.pathname.match(/^\/statuses\/(\d+)\/?$/)?.[1];
      if (id) return { url: anchor.getAttribute('href')!, server: url.origin, id };
    } catch {
      // A malformed href remains an ordinary link.
    }
  }
  return null;
}

/** Keep long bare URLs compact while preserving the anchor's real destination. */
function compactContentLinks(content: string, embeddedPostUrl: string | null): string {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = anchor.getAttribute('href')!;
    if (embeddedPostUrl === href) {
      const parent = anchor.parentElement;
      anchor.remove();
      if (parent?.tagName === 'P' && !parent.textContent?.trim() && !parent.children.length) {
        parent.remove();
      }
      continue;
    }
    try {
      const url = new URL(href);
      const visible = (anchor.textContent ?? '').trim();
      if (/^https?:\/\//i.test(visible)) {
        const hasTail = url.pathname !== '/' || !!url.search || !!url.hash;
        anchor.textContent = `${url.host}${hasTail ? '/…' : ''}`;
      }
    } catch {
      // Relative and malformed links keep their server-supplied label.
    }
  }
  return doc.body.innerHTML;
}

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
    NgOptimizedImage,
    LocalCompose,
    ShareDialog,
    BookmarkProviderDialog,
  ],
  templateUrl: './status-card.html',
  styleUrl: './status-card.css',
})
export class StatusCard {
  private api = inject(Api);
  protected auth = inject(Auth);
  private prefs = inject(ClientPrefs);
  private actions = inject(StatusActions);
  private router = inject(Router);
  private mutedPosts = inject(MutedPosts);
  private localMod = inject(LocalModeration);
  private visibility = inject(StatusVisibility);
  protected capabilities = inject(AnonymousCapabilities);
  private anonymousBookmarks = inject(AnonymousBookmarks);
  private anonymousPublic = inject(AnonymousPublicApi);
  private raindrop = inject(RaindropSession);
  private server = inject(Server);

  /** Pictures render only when images are on and feed reader mode is off. */
  protected imagesVisible = computed(() => this.prefs.showImages() && !this.prefs.feedReader());

  /**
   * Icon standing in for one attachment when images are off. Mastodon's media
   * types are image / video / gifv / audio / unknown; picking a matching glyph
   * keeps the text-only list honest about what is actually being hidden.
   */
  protected mediaIcon(media: MediaAttachment): string {
    switch (media.type) {
      case 'video':
      case 'gifv':
        return '🎬';
      case 'audio':
        return '🔊';
      default:
        return '🖼️';
    }
  }

  /** ⭐ or ❤️, per the Mockingbird Blue preference. */
  protected favIcon = computed(() => (this.prefs.favStyle() === 'heart' ? '❤️' : '⭐'));

  /** post/boost vs tweet/retweet wording, per the Mockingbird Blue preference. */
  protected words = inject(Terminology).words;

  /**
   * The card renders as nothing when the viewer hid this specific post ("mute
   * this post") or has locally blocked/muted its author. Reading the moderation
   * signals here means the card disappears the moment the viewer acts.
   */
  protected mutedLocally = computed(() => this.visibility.mutedLocally(this.status()));

  /** Whether the viewer has locally blocked this card's author. */
  protected authorBlockedLocally = computed(() => {
    this.localMod.entries();
    return this.localMod.isBlocked(this.display.account);
  });

  /** Whether the viewer has locally muted this card's author. */
  protected authorMutedLocally = computed(() => {
    this.localMod.entries();
    return this.localMod.isMuted(this.display.account);
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

  /** A legacy quote represented only by a Mastodon post URL in the body. */
  private linkQuote = signal<Status | null>(null);
  private linkQuoteUrl = signal<string | null>(null);
  private resolveLinkQuote = effect((onCleanup) => {
    const display = this.display;
    const ref = display.quote ? null : mastodonPostRef(display.content);
    this.linkQuote.set(null);
    this.linkQuoteUrl.set(null);
    if (!ref || ref.url === display.url) return;
    const subscription = this.anonymousPublic
      .getStatus({ server: ref.server, id: ref.id, originalUrl: ref.url })
      .subscribe({
        next: (status) => {
          this.linkQuote.set(status);
          this.linkQuoteUrl.set(ref.url);
        },
        error: () => undefined,
      });
    onCleanup(() => subscription.unsubscribe());
  });

  // Inline composers (reply / quote), shown beneath the status when toggled.
  protected replying = signal(false);
  protected quoting = signal(false);
  protected showShare = signal(false);

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

  // --- sensitive media ---

  /** Viewer clicked through the sensitive-media blur; resets per status. */
  private sensitiveRevealed = linkedSignal({ source: this.status, computation: () => false });

  /**
   * True while media should sit behind a "sensitive content" blur. A CW already
   * gates the whole body, so we only blur when the post is flagged sensitive but
   * carries no spoiler text — and only until the viewer reveals it.
   */
  protected mediaBlurred = computed(
    () => this.display.sensitive && !this.spoilerText() && !this.sensitiveRevealed(),
  );

  revealSensitive(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.sensitiveRevealed.set(true);
  }

  /** Older cached poll payloads may omit own_votes; treat them as no selected options. */
  protected pollOwnVote(poll: Poll, index: number): boolean {
    const ownVotes = (poll as Partial<Poll>).own_votes;
    return Array.isArray(ownVotes) && ownVotes.includes(index);
  }

  // --- content filters (server-computed `filtered`, applied client-side) ---

  /** Matched filters that apply in this timeline's context. */
  private activeFilters = computed<FilterResult[]>(() =>
    this.visibility.activeFilters(this.status(), this.filterContext()),
  );

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

  /** Body HTML with mobile-safe bare-link labels and a resolved quote URL removed. */
  protected renderedContent = computed(() =>
    compactContentLinks(
      this.md(this.translation()?.content ?? this.display.content),
      this.linkQuoteUrl(),
    ),
  );

  // Poll voting state (selected option positions before submitting).
  protected pollSelection = signal<number[]>([]);

  // Dialogs.
  protected accountListMode = signal<AccountListMode | null>(null);
  protected showHistory = signal(false);
  protected showPolicyMenu = signal(false);

  // Image lightbox: the index of the attachment being viewed, or null when closed.
  protected lightboxIndex = signal<number | null>(null);

  /** Whether the logged-in user owns the displayed status (can edit/delete). */
  protected isOwn = computed(
    () => !this.capabilities.active && this.display.account.id === this.auth.account()?.id,
  );

  /** True when this status quotes one of the viewer's own statuses (revocable). */
  protected canRevokeQuote = computed(() => {
    const q = this.display.quote?.quoted_status;
    return (
      !this.capabilities.active &&
      !!q &&
      q.account.id === this.auth.account()?.id &&
      this.display.quote?.state === 'accepted'
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
        if (!this.foreign && this.capabilities.canCompose) {
          this.toggleQuote(event);
        }
        return true;
      case 'enter':
      case 'o':
        if (this.threadLink) {
          void this.router.navigate(this.threadLink);
        }
        return true;
      case 'p':
        if (this.accountLink) {
          void this.router.navigate(this.accountLink);
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
    if (!this.capabilities.canUseServerActions) {
      return;
    }
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

  /** Hide this post locally for 30 days (there is no server-side per-post hide). */
  mutePost(event: Event): void {
    event.stopPropagation();
    this.mutedPosts.mute(this.display.id);
  }

  /**
   * Mute this card's author for `seconds` (null = indefinitely). Always records
   * a client-side mute (works for every provider, including read-only
   * Anonymous), and additionally issues the real server-side mute when the
   * viewer has that capability, so an authenticated account stays in sync.
   */
  muteAuthorLocally(event: Event, seconds: number | null): void {
    event.stopPropagation();
    this.localMod.mute(this.display.account, seconds);
    if (this.capabilities.canManageRelationships && !this.foreign) {
      this.api.muteAccount(this.display.account.id, seconds ?? undefined).subscribe({
        error: () => this.actionError.set('Muted locally, but the server mute failed.'),
      });
    }
  }

  /**
   * Block this card's author. Always records a client-side block (hides them
   * everywhere, works for every provider); also issues the real server-side
   * block when the viewer can, keeping an authenticated account in sync.
   */
  blockAuthorLocally(event: Event): void {
    event.stopPropagation();
    this.localMod.block(this.display.account);
    if (this.capabilities.canManageRelationships && !this.foreign) {
      this.api.block(this.display.account.id).subscribe({
        error: () => this.actionError.set('Blocked locally, but the server block failed.'),
      });
    }
  }

  /** Lift a local block/mute on this card's author (client-side only). */
  unsuppressAuthorLocally(event: Event): void {
    event.stopPropagation();
    this.localMod.clear(this.display.account);
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
    const mention = this.mentionLink(anchor, href);
    if (mention) {
      event.preventDefault();
      event.stopPropagation();
      void this.router.navigate(mention);
      return;
    }
    // Treat anything else with an explicit http(s) origin as external.
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  /** Shared with bios and other rendered HTML — see {@link hashtagNameFrom}. */
  private hashtagName(anchor: HTMLAnchorElement, href: string): string | null {
    return hashtagNameFrom(anchor, href);
  }

  /** Route resolved Mastodon mentions to Mawkingbird's profile page. */
  private mentionLink(anchor: HTMLAnchorElement, href: string): (string | number)[] | null {
    if (!anchor.classList.contains('mention') || anchor.classList.contains('hashtag')) return null;
    const visible = (anchor.textContent ?? '').trim().replace(/^@/, '').toLocaleLowerCase();
    const mention = this.display.mentions?.find(
      (candidate) =>
        candidate.url === href ||
        candidate.acct.toLocaleLowerCase() === visible ||
        candidate.username.toLocaleLowerCase() === visible,
    );
    if (!mention) return null;
    if (this.display.provider === 'anonymous-mastodon') {
      try {
        return [
          '/accounts',
          anonymousAccountRouteRef({
            server: new URL(mention.url).origin,
            id: mention.id,
            originalUrl: mention.url,
          }),
        ];
      } catch {
        return null;
      }
    }
    return ['/accounts', mention.id];
  }

  /** The status to render: unwrap a boost to the original. */
  get display(): Status {
    const s = this.status();
    return s.reblog ?? s;
  }

  protected bookmarkActive(): boolean {
    return this.auth.isAnonymous
      ? this.anonymousBookmarks.has(this.display)
      : this.display.bookmarked;
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
   * A provider that reports real engagement counts the viewer cannot act on.
   *
   * X is the first of these and the reason this exists. Its posts carry genuine
   * reply, repost and like counts — 244 likes, 77k views on a real NASA post —
   * but no viewer of this app can add to them, because every write on Twitter needs an
   * authenticated Twitter account this app deliberately never asks for.
   *
   * Before this, those numbers were invisible: the counts render under
   * `caps.favourite`/`caps.reblog`, which are `false` for Twitter precisely *because*
   * the actions are impossible. So the capability flag was doing two jobs —
   * "can you press this" and "is there a number worth showing" — and the second
   * answer was wrong. RSS and paste genuinely have nothing to show; X has a lot.
   */
  protected get readOnlyStats(): boolean {
    return this.display.provider === 'twitter';
  }

  /**
   * This post on Nitter, or null when it is not a tweet.
   *
   * Null rather than a fallback so the template can keep "↗ Open original" for
   * every other foreign provider — an RSS item's original site is the whole
   * point of the link, and there is nothing to rewrite it to.
   */
  protected get nitterLink(): string | null {
    return this.display.provider === 'twitter' ? toNitterUrl(this.display.url) : null;
  }

  /**
   * True when the thread page can render this post in a conversation view.
   * Bluesky threads load via `getPostThread`; RSS items open a reader view of
   * the article (plus a comment feed when the publisher declares one).
   */
  protected get threadable(): boolean {
    if (this.isLocalPractice) {
      return true;
    }
    const provider = this.display.provider ?? 'mastodon';
    if (provider === 'anonymous-mastodon') {
      const ref = this.anonymousRef;
      return !!ref && !ref.statusId.startsWith('rss:');
    }
    return (
      provider === 'mastodon' ||
      provider === 'bluesky' ||
      provider === 'rss' ||
      // tweets open a thread view backed by `tweet/replies`. Costs one request
      // per open, which is why the thread page shows the price and does not
      // walk ancestors — see spec/ui/twitter_remaining_roadmap.md §2.
      provider === 'twitter'
    );
  }

  protected get threadLink(): (string | number)[] | null {
    if (!this.threadable) return null;
    // Local practice posts (Eliza's and the viewer's) thread by their raw id;
    // the thread page reads them from the browser-local stores.
    if (this.isLocalPractice) {
      return ['/statuses', this.display.id];
    }
    const ref = this.anonymousRef;
    if (this.display.provider === 'anonymous-mastodon') {
      if (!ref?.statusId) return null;
      return [
        '/statuses',
        anonymousStatusRouteRef({
          server: ref.server,
          id: ref.statusId,
          originalUrl: this.display.url ?? undefined,
        }),
      ];
    }
    return ['/statuses', this.display.id];
  }

  /**
   * The account link for this card's author, or null when there's no profile to
   * open. RSS feeds get a synthetic "feed = profile" page (`/accounts/rss:<url>`);
   * per-comment author accounts (`rss:<url>::author::<name>`) have no page.
   */
  protected get accountLink(): (string | number)[] | null {
    const id = this.display.account.id;
    if (!this.foreign) {
      return ['/accounts', id];
    }
    // Eliza's posts (and the viewer's own local practice posts) link straight to
    // the author's profile by id — Eliza's synthetic profile, or the viewer's.
    if (this.isLocalPractice) {
      return ['/accounts', id];
    }
    const ref = this.anonymousRef;
    if (this.display.provider === 'anonymous-mastodon' && ref?.accountId) {
      return [
        '/accounts',
        anonymousAccountRouteRef({
          server: ref.server,
          id: ref.accountId,
          originalUrl: this.display.account.url || undefined,
        }),
      ];
    }
    if (this.display.provider === 'rss' && id.startsWith('rss:') && !id.includes('::')) {
      return ['/accounts', id];
    }
    // Twitter accounts already have a working profile page (the Sprint 4 screen);
    // nothing linked to it, which made avatars and display names dead text.
    if (this.display.provider === 'twitter' && id.startsWith('twitter:@')) {
      return ['/accounts', id];
    }
    // Bluesky ids are `bsky:<did>`, and a DID is route-safe (`did:plc:abc123`).
    if (this.display.provider === 'bluesky' && id.startsWith('bsky:')) {
      return ['/accounts', id];
    }
    return null;
  }

  private get anonymousRef(): AnonymousProviderRef | null {
    const ref = this.display.providerRef as Partial<AnonymousProviderRef> | undefined;
    if (
      !ref ||
      typeof ref.server !== 'string' ||
      typeof ref.statusId !== 'string' ||
      typeof ref.accountId !== 'string'
    ) {
      return null;
    }
    try {
      const protocol = new URL(ref.server).protocol;
      return protocol === 'https:' || protocol === 'http:' ? (ref as AnonymousProviderRef) : null;
    } catch {
      return null;
    }
  }

  protected get providerBadge(): string | null {
    switch (this.display.provider) {
      case 'rss':
        return '📡 RSS';
      case 'bluesky':
        return '🦋 Bluesky';
      case 'anonymous-mastodon':
        return '🐘 Mastodon';
      case 'twitter':
        return '🐦 Twitter';
      case 'blog':
        return '✍️ Blog';
      default:
        return null;
    }
  }

  /** Which interactions this post's network supports (buttons hide per provider). */
  protected get caps(): ProviderCapabilities {
    return this.capabilities.statusCaps(this.display.provider ?? 'mastodon');
  }

  /** A browser-local practice post — the viewer's own (`local:`) or one of
   *  Eliza's (`eliza:`). These support replying locally even for anonymous
   *  visitors, and their replies route through {@link LocalPostStore}, never the
   *  network. */
  protected get isLocalPractice(): boolean {
    const id = this.display.id;
    return id.startsWith('local:') || isElizaId(id);
  }

  /** Whether to show an enabled reply affordance: either the network supports it,
   *  or it's a local practice post the viewer can always reply to. */
  protected get canReply(): boolean {
    return this.caps.reply || this.isLocalPractice;
  }

  /** Public Mastodon edit history remains readable without a user token. */
  protected get canViewPublicHistory(): boolean {
    const ref = this.anonymousRef;
    return (
      this.auth.isAnonymous && !!this.display.edited_at && !!ref && !ref.statusId.startsWith('rss:')
    );
  }

  protected get historyStatusId(): string {
    return this.anonymousRef?.statusId ?? this.display.id;
  }

  protected get historyServer(): string | null {
    return this.display.provider === 'anonymous-mastodon'
      ? (this.anonymousRef?.server ?? null)
      : null;
  }

  get boostedBy(): string | null {
    const s = this.status();
    return s.reblog ? s.account.display_name : null;
  }

  /** The quoted status to embed, if this status quotes a visible one. */
  protected quotedStatus = computed<Status | null>(
    () => this.display.quote?.quoted_status ?? this.linkQuote(),
  );

  /** Thread route for both native quote entities and URL-resolved remote quotes. */
  protected quoteThreadLink(status: Status): (string | number)[] {
    const ref = status.providerRef as Partial<AnonymousProviderRef> | undefined;
    if (status.provider === 'anonymous-mastodon' && ref?.server && ref.statusId) {
      return [
        '/statuses',
        anonymousStatusRouteRef({
          server: ref.server,
          id: ref.statusId,
          originalUrl: status.url ?? undefined,
        }),
      ];
    }
    return ['/statuses', status.id];
  }

  /** True when a quote exists but the quoted status is hidden (e.g. revoked). */
  protected quoteUnavailable = computed<boolean>(() => {
    const q = this.display.quote;
    return !!q && q.quoted_status === null;
  });

  // --- inline reply / quote ---
  toggleReply(event: Event): void {
    event.stopPropagation();
    // Local practice posts are always replyable; otherwise a real compose
    // capability is required.
    if (!this.capabilities.canCompose && !this.isLocalPractice) {
      return;
    }
    this.quoting.set(false);
    this.replying.update((v) => !v);
  }

  toggleQuote(event: Event): void {
    event.stopPropagation();
    if (!this.capabilities.canCompose) {
      return;
    }
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
  /** Successful external actions are announced without styling them as failures. */
  protected actionNotice = signal<string | null>(null);
  protected showBookmarkProviders = signal(false);
  protected externalBookmarkUrl = computed(() =>
    firstExternalLink(this.display.content, this.server.baseUrl()),
  );

  toggleFavourite(event: Event): void {
    event.stopPropagation();
    if (!this.caps.favourite) {
      return;
    }
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
    if (!this.caps.reblog) {
      return;
    }
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
    if (!this.capabilities.canBookmark) {
      return;
    }
    if (this.raindrop.connected()) {
      this.showBookmarkProviders.set(true);
      return;
    }
    this.toggleNativeBookmark();
  }

  protected chooseBookmark(choice: BookmarkChoice): void {
    this.showBookmarkProviders.set(false);
    if (choice === 'mastodon') {
      this.toggleNativeBookmark();
      return;
    }
    this.actionBusy.set(true);
    this.actionError.set(null);
    this.actionNotice.set(null);
    const target = choice === 'raindrop-link' ? 'external-link' : 'post';
    void this.raindrop
      .addBookmark(this.display, target, this.externalBookmarkUrl() ?? undefined)
      .then(() => {
        this.actionBusy.set(false);
        this.actionNotice.set(
          choice === 'raindrop-link'
            ? 'External link saved to Raindrop.io.'
            : 'Post saved to Raindrop.io.',
        );
      })
      .catch((error: unknown) => {
        this.actionBusy.set(false);
        this.actionError.set(
          error instanceof Error ? error.message : "Raindrop.io couldn't save that bookmark.",
        );
      });
  }

  /**
   * Bookmark locally or on the server, depending on where the post lives.
   *
   * The test is "does the home server know this post", not "am I signed in".
   * Those coincide for Mastodon posts and come apart for every foreign
   * provider: a signed-in reader bookmarking a tweet used to send
   * `twitter:2083…` to `/api/v1/statuses/{id}/bookmark`, which 404s and loses
   * the bookmark silently. Anonymous readers got a working local bookmark for
   * the same post, so signing in made the feature worse — parity inverted.
   *
   * Local storage is the right home for these regardless of session: the home
   * server cannot bookmark a post it has never seen, and {@link
   * AnonymousBookmarks} already keys off the status rather than a Mastodon id.
   */
  private toggleNativeBookmark(): void {
    const s = this.display;
    if (this.auth.isAnonymous || !serverKnowsStatus(s.provider)) {
      this.changed.emit(this.anonymousBookmarks.toggle(s));
      return;
    }
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
    // Already in your language: the call would hand back the post you are reading, so
    // it is refused before it costs a request or a slot in the daily budget.
    if (this.alreadyInTargetLanguage()) {
      this.translateError.set(this.sameLanguageMessage());
      return;
    }
    // Metered against the instance's own budget, which is separate from OpenRouter's
    // (see TranslationUsage). Checked before the call, not after: a limit that only
    // notices once the request is in flight has not limited anything.
    if (!this.usage.canSpend('mastodon')) {
      this.translateError.set(this.limitMessage('mastodon'));
      return;
    }
    this.translating.set(true);
    this.translateError.set(null);
    this.usage.record('mastodon');
    this.api.translate(this.display.id).subscribe({
      next: (t) => {
        this.translation.set(t);
        this.translating.set(false);
      },
      error: () => {
        this.translating.set(false);
        // Most servers have no translation provider configured at all, so this is
        // the common path rather than an edge. Offer the way out instead of
        // dead-ending on a button that did nothing.
        this.translateError.set(
          this.openrouter.connected()
            ? "Your server couldn't translate this. Try AI translation instead."
            : "Your server couldn't translate this post.",
        );
      },
    });
  }

  // --- AI translation (anonymous-great sprint 3) ---
  private openrouter = inject(OpenRouterSession);
  private ai = inject(AiAvailability);
  private aiTranslate = inject(AiTranslate);
  protected translatePref = inject(TranslationPreference);

  /** Untrusted model output. Rendered as text; never near the `[innerHTML]` path. */
  protected aiTranslation = signal<AiTranslation | null>(null);
  protected aiTranslating = signal(false);
  protected translateError = signal<string | null>(null);
  protected translateChoiceOpen = signal(false);
  protected rememberChoice = signal(false);

  /** Per-engine daily budgets. Injected here because this card owns both call sites. */
  private usage = inject(TranslationUsage);

  /**
   * What to say when an engine's daily hard limit has been reached.
   *
   * Names the engine, because the other one may still have allowance — "you are out of
   * translations" would be wrong when only half the capability is exhausted, and would
   * hide the fact that there is a second way through.
   */
  /**
   * True when this post already appears to be in the language we'd translate into.
   *
   * The target is whatever the translator would aim for — the reader's own language —
   * so this asks `AiTranslate` for it rather than assuming English.
   */
  private alreadyInTargetLanguage(): boolean {
    return this.eligibility.isAlreadyTargetLanguage(
      this.display,
      this.aiTranslate.targetLanguage(),
    );
  }

  /** Explains a refusal, and says how to override it — never a dead end. */
  private sameLanguageMessage(): string {
    const target = languageName(this.aiTranslate.targetLanguage());
    return (
      `This post already looks like ${target}, so translating it would return the same text. ` +
      `You can turn this check off in Settings → Internationalization.`
    );
  }

  private limitMessage(engine: TranslationEngine): string {
    return (
      `You've used today's ${ENGINE_LABELS[engine]} translation limit ` +
      `(${this.usage.hardLimit(engine)}). It resets at midnight, or you can raise it in ` +
      `Settings → Internationalization.`
    );
  }

  /**
   * Whether to show the 🤖🌐 button.
   *
   * For anonymous readers: **always**, connected or not. This is a deliberate
   * exception to `openrouter-0-overview.md` decision 9 ("helper buttons are hidden
   * when OpenRouter isn't connected — no upsell, no teaser"). That rule holds where
   * a helper is an addition to a surface that already works; here `canUseServerActions`
   * has taken the only translate button away, so hiding this one makes the capability
   * invisible rather than merely unavailable. Unconnected, it explains itself once.
   *
   * For signed-in users the rule stands: the server 🌐 already works, so the AI
   * button appears only once OpenRouter is connected.
   */
  protected showAiTranslate = computed(
    () => this.capabilities.active || this.openrouter.connected() || this.serverCannotTranslate,
  );

  /**
   * True when the home server could not translate this post even if asked.
   *
   * Translation for a read-only provider means "ask the autorouter": the server
   * has never seen an X, RSS or paste post, so `/api/v1/statuses/{id}/translate`
   * can only fail on an id it cannot resolve. The AI path works from the post
   * text already in hand, so it is the only one that can succeed.
   *
   * Without this the 🌐 button was hidden (it needs `canUseServerActions`) and
   * the 🤖🌐 button was hidden too (it needed anonymous mode), so a signed-in
   * reader looking at a tweet got no translate control at all — the
   * capability vanished rather than being merely unavailable.
   */
  protected get serverCannotTranslate(): boolean {
    return !serverKnowsStatus(this.display.provider);
  }

  /** Drives the dialog's two faces: chooser when connected, upsell when not. */
  // AI translation is an AI surface, so it answers to the AI switch as well as
  // to whether a key exists. See AiAvailability.
  protected openrouterConnected = computed(() => this.ai.enabled() && this.openrouter.connected());

  /** The 🌐 click for a signed-in user, routed by preference. */
  translateByPreference(event: Event): void {
    event.stopPropagation();
    switch (this.translatePref.choice()) {
      case 'ai':
        void this.runAiTranslate();
        return;
      case 'ask':
        this.translateChoiceOpen.set(true);
        return;
      default:
        this.toggleTranslate(event);
    }
  }

  /** Chosen from the ask-dialog. Optionally remembered. */
  chooseTranslator(which: 'server' | 'ai', event: Event): void {
    event.stopPropagation();
    this.translateChoiceOpen.set(false);
    if (this.rememberChoice()) {
      this.translatePref.set(which);
    }
    if (which === 'ai') {
      void this.runAiTranslate();
    } else {
      this.toggleTranslate(event);
    }
  }

  /**
   * Translate with the chosen model, or explain why we can't.
   *
   * Unconnected is not an error state — it is a thing the user hasn't set up yet, so
   * it gets a sentence and a link rather than red text.
   */
  async runAiTranslate(): Promise<void> {
    if (this.aiTranslation()) {
      this.aiTranslation.set(null);
      return;
    }
    if (!this.openrouter.connected()) {
      this.translateChoiceOpen.set(true);
      return;
    }
    if (this.alreadyInTargetLanguage()) {
      this.translateError.set(this.sameLanguageMessage());
      return;
    }
    // OpenRouter's budget is its own. Spending here must never be blocked by, or
    // consume, the instance endpoint's allowance — the two engines fail independently.
    if (!this.usage.canSpend('openrouter')) {
      this.translateError.set(this.limitMessage('openrouter'));
      return;
    }
    this.aiTranslating.set(true);
    this.translateError.set(null);
    this.usage.record('openrouter');
    try {
      this.aiTranslation.set(await this.aiTranslate.translateHtml(this.display.content));
    } catch (error: unknown) {
      this.translateError.set(
        error instanceof Error ? error.message : "The model couldn't translate this.",
      );
    } finally {
      this.aiTranslating.set(false);
    }
  }

  onAiTranslateClick(event: Event): void {
    event.stopPropagation();
    void this.runAiTranslate();
  }

  // --- automatic translation (i18n sprint 3) ---

  private eligibility = inject(AutoTranslateEligibility);
  private host = inject(ElementRef<HTMLElement>);

  /**
   * True once this card has tried to auto-translate, successfully or not.
   *
   * Guards against the trigger firing repeatedly — an `IntersectionObserver` reports
   * every scroll back into view, and a hover fires on every pass of the mouse. Without
   * this, reading a post twice would pay for it twice. Set before the request rather
   * than after, so an in-flight translation cannot be started again by a second event.
   */
  private autoTried = false;

  /** Whether the translation on this card came from the automatic path. */
  protected autoTranslated = signal(false);

  /**
   * True when this card's translation should render *below* the original rather than
   * replacing it. Only ever set for a language the reader is learning.
   */
  protected appendMode = signal(false);

  /** The observer watching this card, when the trigger mode is `view`. */
  private observer: IntersectionObserver | null = null;

  constructor() {
    // The trigger is set up reactively rather than in ngOnInit because the mode can
    // change while cards are on screen: switching to `hover` mid-scroll must detach the
    // observers immediately, not at the next navigation.
    effect(() => {
      const mode = this.prefs.autoTranslateMode();
      this.detachObserver();
      if (mode === 'view' && !this.autoTried) {
        this.attachObserver();
      }
    });
    inject(DestroyRef).onDestroy(() => this.detachObserver());
  }

  private attachObserver(): void {
    // jsdom has no IntersectionObserver, and neither do very old browsers. Absent it,
    // `view` mode simply never fires — which is the safe direction for a feature that
    // spends money.
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void this.autoTranslate();
        }
      },
      // A little over half the card visible: enough that it is genuinely being read,
      // rather than clipping the viewport edge during a fast scroll.
      { threshold: 0.6 },
    );
    this.observer.observe(this.host.nativeElement);
  }

  private detachObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** The hover trigger. Does nothing unless `hover` is the chosen mode. */
  onCardHover(): void {
    if (this.prefs.autoTranslateMode() === 'hover') {
      void this.autoTranslate();
    }
  }

  /**
   * Translate this post automatically, if it is one of the posts that should be.
   *
   * Every early return here is a call not spent. The eligibility rules live in
   * {@link AutoTranslateEligibility}; the budget lives in {@link TranslationUsage}; this
   * method's only job is to consult both before doing anything, and to stop trying once
   * it has tried.
   */
  private async autoTranslate(): Promise<void> {
    if (this.autoTried || this.translation() || this.aiTranslation()) {
      return;
    }
    if (!this.eligibility.shouldTranslate(this.display)) {
      return;
    }
    // Silent here, unlike the manual path: nobody asked, so there is nothing to explain.
    if (this.alreadyInTargetLanguage()) {
      return;
    }
    // Claimed up front: two intersection callbacks can arrive before the first request
    // resolves, and each would otherwise start its own.
    this.autoTried = true;
    this.detachObserver();
    this.appendMode.set(this.eligibility.appends(this.display));

    // Automatic translation uses the instance endpoint unless the reader has explicitly
    // allowed it to spend OpenRouter credit. A read-only provider's post has no server
    // translation to ask for, so AI is the only engine that could work — but that is
    // still not permission to spend, so it is skipped rather than silently upgraded.
    const useAi = this.prefs.autoTranslateUsesAi() && this.openrouterConnected();
    if (this.serverCannotTranslate && !useAi) {
      return;
    }

    const engine = useAi ? 'openrouter' : 'mastodon';
    if (!this.usage.canSpend(engine)) {
      // Silent: an automatic pass hitting its ceiling is the budget working, not an
      // error the reader needs interrupting for. The count is on the settings screen.
      return;
    }

    this.autoTranslated.set(true);
    if (useAi) {
      this.usage.record('openrouter');
      this.aiTranslating.set(true);
      try {
        this.aiTranslation.set(await this.aiTranslate.translateHtml(this.display.content));
      } catch {
        // A failed automatic translation leaves the original post exactly as it was,
        // which is a perfectly good outcome. Errors belong to translations the reader
        // asked for by pressing something.
        this.autoTranslated.set(false);
      } finally {
        this.aiTranslating.set(false);
      }
      return;
    }

    this.usage.record('mastodon');
    this.translating.set(true);
    this.api.translate(this.display.id).subscribe({
      next: (t) => {
        this.translation.set(t);
        this.translating.set(false);
      },
      error: () => {
        this.translating.set(false);
        this.autoTranslated.set(false);
      },
    });
  }

  /**
   * The original post body, for the append view.
   *
   * `renderedContent()` swaps the translation in for the original, which is the right
   * behaviour for replace mode and exactly wrong for a learner: they need both. This
   * renders the untranslated body regardless of translation state, so the append block
   * can show the original above and the translation below.
   */
  protected originalContent = computed(() =>
    compactContentLinks(this.md(this.display.content), this.linkQuoteUrl()),
  );

  // --- polls ---
  protected poll = computed<Poll | null>(() => this.display.poll);

  protected pollClosed = computed<boolean>(() => {
    const p = this.poll();
    return this.capabilities.active || !p || p.expired || p.voted;
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
    if (!this.capabilities.canUseServerActions) {
      return;
    }
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
