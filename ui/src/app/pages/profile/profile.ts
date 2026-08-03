import { Component, computed, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Location, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, map, of, Subscription, switchMap, tap } from 'rxjs';
import { Api } from '../../api';
import { Terminology } from '../../terminology';
import { Auth } from '../../auth';
import { LocalModeration } from '../../local-moderation';
import { Account, Collection, Relationship, Status } from '../../models';
import { homeServerLink } from '../../home-server-link';
import { StatusCard } from '../../status-card/status-card';
import { ReportDialog } from '../../report-dialog/report-dialog';
import { ListDialog } from '../../list-dialog/list-dialog';
import { VerifiedBadge } from '../../verified-badge/verified-badge';
import { HumanCountPipe } from '../../human-count.pipe';
import { PeopleBrowser } from '../../people-browser/people-browser';
import { AccountAnalytics } from '../../account-analytics/account-analytics';
import { RssProvider } from '../../providers/rss/rss-provider';
import { RssSubscriptions } from '../../providers/rss/rss-subscriptions';
import { TwitterApi } from '../../providers/twitter/twitter-api';
import { TwitterFeed } from '../../providers/twitter/twitter-feed';
import { TwitterFollow, TwitterFollows } from '../../providers/twitter/twitter-follows';
import { BlueskyApi } from '../../providers/bluesky/bluesky-api';
import { BlueskyGraph } from '../../providers/bluesky/bluesky-graph';
import { BlueskySession } from '../../providers/bluesky/bluesky-session';
import {
  adaptFeedItem,
  adaptProfile,
  adaptRelationship,
} from '../../providers/bluesky/bluesky-adapter';
import { BskyAuthorFeedFilter } from '../../providers/bluesky/bluesky-types';
import { AnonymousAccount } from '../../providers/anonymous/anonymous-account';
import { AnonymousCapabilities } from '../../providers/anonymous/anonymous-capabilities';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';
import { AnonymousPublicApi } from '../../providers/anonymous/anonymous-public-api';
import {
  AnonymousPublicRef,
  parseAnonymousAccountRouteRef,
} from '../../providers/anonymous/anonymous-route-ref';
import { AnonymousProviderRef } from '../../providers/anonymous/anonymous-mastodon-provider';
import { AccountStatusesOptions } from '../../api';
import { Observable } from 'rxjs';
import { ElizaService } from '../../eliza/eliza.service';
import { isElizaId } from '../../eliza/eliza-identity';
import { AiAvailability } from '../../ai-availability';
import { OpenRouterModelChoice } from '../../providers/openrouter/openrouter-model-choice';
import { OpenRouterSession } from '../../providers/openrouter/openrouter-session';
import { isOpenRouterId, openRouterAccount } from '../../providers/openrouter/openrouter-identity';
import { CloneFriendsDialog } from './clone-friends-dialog/clone-friends-dialog';
import { PageDiagnostics } from '../../page-diagnostics';
import { RenderedHtmlLinks } from '../../rendered-html-links';
import { MataroaSettings } from '../../providers/mataroa/mataroa-settings';

/** Profile body tabs: the account's posts, who they follow, who follows them. */
type ProfileTab = 'posts' | 'following' | 'followers' | 'collections' | 'analytics';

@Component({
  selector: 'app-profile',
  imports: [
    RouterLink,
    StatusCard,
    ReportDialog,
    ListDialog,
    VerifiedBadge,
    HumanCountPipe,
    PeopleBrowser,
    AccountAnalytics,
    NgOptimizedImage,
    CloneFriendsDialog,
    RenderedHtmlLinks,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile implements OnInit, OnDestroy {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private diagnostics = inject(PageDiagnostics);
  protected words = inject(Terminology).words;
  protected auth = inject(Auth);
  private localMod = inject(LocalModeration);
  protected capabilities = inject(AnonymousCapabilities);
  private anonymous = inject(AnonymousAccount);
  private anonymousPublic = inject(AnonymousPublicApi);
  protected anonymousFollows = inject(AnonymousFollows);
  protected eliza = inject(ElizaService);
  private ai = inject(AiAvailability);
  private openRouter = inject(OpenRouterSession);
  private modelChoice = inject(OpenRouterModelChoice);
  private location = inject(Location);
  private rss = inject(RssProvider);
  private mataroa = inject(MataroaSettings);
  private twitterFollows = inject(TwitterFollows);
  private twitterFeed = inject(TwitterFeed);
  private twitterApi = inject(TwitterApi);
  private rssSubs = inject(RssSubscriptions);
  private bskyApi = inject(BlueskyApi);
  private bskyGraph = inject(BlueskyGraph);
  protected bskySession = inject(BlueskySession);
  private destroyRef = inject(DestroyRef);
  private routeLoadSub = new Subscription();
  private statusLoadSub = new Subscription();
  private publicProfileRef: AnonymousPublicRef | null = null;

  /** True when this "profile" is a synthetic RSS feed (id `rss:<feedUrl>`). */
  protected isRss = signal(false);
  /** True when this profile is a Twitter account (id `twitter:@<handle>`). */
  protected isTwitter = signal(false);
  /** The handle behind a Twitter profile, for the follow toggle. */
  private twitterHandle = signal<string | null>(null);
  /** Why this Twitter profile's posts could not be loaded, if they could not. */
  protected twitterError = signal<string | null>(null);
  /**
   * Whether the posts on screen came off disk rather than the network.
   *
   * Shown rather than silently refetched: a refetch costs a billable request,
   * and nobody asked for one by navigating here. The reader gets the saved
   * posts immediately plus a Refresh button, and decides for themselves.
   */
  protected twitterStale = signal(false);
  /** Whether the viewer follows this Twitter account locally. */
  protected twitterFollowed = computed(() => {
    const handle = this.twitterHandle();
    return !!handle && this.twitterFollows.has(handle);
  });
  /** True when this profile is a Bluesky account (id `bsky:<did>`). */
  protected isBluesky = signal(false);
  /** The DID behind a Bluesky profile, for the follow toggle and paging. */
  private bskyDid = signal<string | null>(null);
  /** Why this Bluesky profile's posts (or its follow toggle) failed, if they did. */
  protected bskyError = signal<string | null>(null);
  /** True while a follow/unfollow round-trip is in flight. */
  protected bskyFollowBusy = signal(false);
  /** Paging cursor for `getAuthorFeed`; null once exhausted or before the first page. */
  private bskyCursor: string | null = null;

  /**
   * Bluesky's server-side author-feed filter, derived from the page's own
   * boosts/replies toggles.
   *
   * Mastodon takes these as two independent query params; Bluesky takes one
   * enum, and it has no "replies but no reposts" member. Where they disagree the
   * *replies* toggle wins — it's the one a reader is most likely to have set
   * deliberately — and the reposts toggle is then applied client-side by
   * `visibleStatuses`, which already drops boosts when `showBoosts` is off.
   */
  private bskyFilter(): BskyAuthorFeedFilter {
    return this.showReplies() ? 'posts_with_replies' : 'posts_and_author_threads';
  }

  /**
   * Follow/unfollow on Bluesky.
   *
   * A real network write, unlike the Twitter and RSS buttons next to it — the
   * viewer holds a Bluesky session, so this is an actual follow that the other
   * account will see. The relationship is merged rather than replaced because
   * the response cannot report `followed_by`, which the header shows.
   */
  toggleBlueskyFollow(): void {
    const did = this.bskyDid();
    if (!did || this.bskyFollowBusy()) {
      return;
    }
    this.bskyFollowBusy.set(true);
    this.bskyError.set(null);
    const following = this.relationship()?.following ?? false;
    const call = following ? this.bskyGraph.unfollow(did) : this.bskyGraph.follow(did);
    call.subscribe({
      next: (updated) => {
        this.relationship.update((current) => ({ ...current, ...updated }));
        // Keep the header's follower count honest without a refetch.
        this.account.update((a) =>
          a
            ? {
                ...a,
                followers_count: Math.max(0, a.followers_count + (following ? -1 : 1)),
              }
            : a,
        );
        this.bskyFollowBusy.set(false);
        this.diagnostics.info('Profile', 'bsky:follow-toggled', { did, following: !following });
      },
      error: (error: unknown) => {
        this.bskyFollowBusy.set(false);
        this.diagnostics.error('Profile', 'bsky:follow-failed', error, { did });
        this.bskyError.set(
          error instanceof Error ? error.message : 'Could not update the follow on Bluesky.',
        );
      },
    });
  }

  /** The feed URL behind an RSS profile, for the subscribe toggle. */
  private rssFeedUrl = signal<string | null>(null);
  /** Whether the viewer is currently subscribed to this feed. */
  protected rssSubscribed = computed(() => {
    const url = this.rssFeedUrl();
    return !!url && this.rssSubs.has(url) && this.rssSubs.enabledFeeds().some((f) => f.url === url);
  });

  toggleRssSubscription(): void {
    const url = this.rssFeedUrl();
    const account = this.account();
    if (!url) {
      return;
    }
    if (this.rssSubs.has(url)) {
      this.rssSubs.remove(url);
    } else {
      this.followError.set(this.rssSubs.add(url, account?.display_name || url));
    }
  }

  protected account = signal<Account | null>(null);

  /** Where to open this profile on its own server, or null if there is nowhere. */
  protected homeServerLink = computed(() => homeServerLink(this.account()));

  protected statuses = signal<Status[]>([]);
  /** Mataroa RSS items optionally folded into the signed-in user's own profile. */
  private blogStatuses = signal<Status[]>([]);
  protected relationship = signal<Relationship | null>(null);
  protected loading = signal(true);
  protected statusesLoading = signal(false);
  protected loadingMore = signal(false);
  /** An older page came back empty: the account's history is fully loaded. */
  protected exhausted = signal(false);

  // Timeline filter toggles. Defaults mirror Mastodon's profile view:
  // boosts shown, replies hidden, pinned strip on top.
  protected showBoosts = signal(true);
  protected showReplies = signal(false);
  protected showPinned = signal(true);
  protected pinnedStatuses = signal<Status[]>([]);
  /** Which body tab is showing: the posts feed, or a people browser. */
  protected tab = signal<ProfileTab>('posts');

  setTab(tab: ProfileTab): void {
    this.tab.set(tab);
  }

  /** The anonymous public-profile ref, for children that need read-only API access. */
  protected get publicRef(): AnonymousPublicRef | null {
    return this.publicProfileRef;
  }

  protected peopleServer(): string | null {
    return this.auth.isAnonymous
      ? (this.publicProfileRef?.server ?? this.anonymous.server())
      : null;
  }
  /** Invalidates in-flight status fetches when filters change or the route moves. */
  private loadSeq = 0;

  /** The main list, minus anything already shown in the pinned strip. */
  protected visibleStatuses = computed(() => {
    const combined = [...this.statuses(), ...this.blogStatuses()].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    if (!this.showPinned()) {
      return combined;
    }
    const pinnedIds = new Set(this.pinnedStatuses().map((s) => s.id));
    return combined.filter((s) => !pinnedIds.has(s.id));
  });

  protected showReport = signal(false);
  protected showLists = signal(false);
  protected reportDone = signal(false);
  protected showBlockConfirm = signal(false);
  protected showUnfollowConfirm = signal(false);
  protected showRemoveFollowerConfirm = signal(false);
  protected followError = signal<string | null>(null);

  protected isSelf = computed(() => this.account()?.id === this.auth.account()?.id);
  /** True when this profile is Eliza's — unlocks her local "Message" button. */
  protected isEliza = computed(() => isElizaId(this.account()?.id));
  protected isOpenRouter = computed(() => isOpenRouterId(this.account()?.id));

  // --- clone friends list (anonymous-great sprint 2) ---

  protected showCloneFriends = signal(false);

  /**
   * Whether to offer "Clone friends list".
   *
   * **Anonymous only, and that is the safety property — not an unfinished edge.**
   * An anonymous follow is a row in `localStorage`, so adopting twenty accounts
   * sends zero write requests to anybody's server. The same button for a signed-in
   * user would fire twenty `POST /accounts/:id/follow` calls back to back, which is
   * indistinguishable from a follow-bot and is how people get suspended. This
   * feature is safe *because* it is anonymous-only; do not later add a rate limiter
   * and turn it on for authenticated users.
   *
   * Also requires the profile to follow somebody (nothing to clone otherwise) and
   * not to be an RSS pseudo-profile, which has no follow graph at all.
   */
  protected canCloneFriends = computed(
    () =>
      this.capabilities.active &&
      !this.isRss() &&
      !this.isSelf() &&
      (this.account()?.following_count ?? 0) > 0,
  );

  protected openCloneFriends(): void {
    this.showCloneFriends.set(true);
  }

  /**
   * The public reference the dialog reads `/following` through.
   *
   * A signal, unlike the existing `publicRef` getter, because the template binds it
   * as an input and a plain getter would not notify on change. Anonymous profiles
   * reached cross-instance carry a `{ server, id }` ref, and reading their follows
   * has to go to that server rather than ours.
   */
  protected cloneRef = signal<AnonymousPublicRef | null>(null);

  /**
   * The dialog reports how many it followed; the page just closes it.
   *
   * Nothing on this profile needs refreshing: cloning @alice's friends does not
   * change your relationship to @alice, and `AnonymousFollows.follow` has already
   * invalidated the home-feed cache, which is the state that actually moved.
   */
  protected onCloned(): void {
    this.showCloneFriends.set(false);
  }

  /** Discoverable Mastodon 4.6 Collections curated by this profile. */
  protected collections = signal<Collection[]>([]);

  /** Accounts this profile features ("collections") — shown prominently up top. */
  protected featured = signal<Account[]>([]);
  /** Ids among featured() the viewer already follows (or has requested). */
  protected featuredFollowing = signal<Set<string>>(new Set());
  protected featuredBusy = signal(false);

  protected featuredToFollow = computed(() =>
    this.featured().filter(
      (f) => !this.featuredFollowing().has(f.id) && f.id !== this.auth.account()?.id,
    ),
  );

  /** Return to the previous page (e.g. back to search results). */
  goBack(): void {
    this.location.back();
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.load(id);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeLoadSub.unsubscribe();
    this.statusLoadSub.unsubscribe();
  }

  load(id: string): void {
    this.routeLoadSub.unsubscribe();
    this.routeLoadSub = new Subscription();
    this.statusLoadSub.unsubscribe();
    this.loading.set(true);
    this.blogStatuses.set([]);
    this.relationship.set(null);
    this.reportDone.set(false);
    this.followError.set(null);
    this.isRss.set(false);
    this.publicProfileRef = null;
    this.cloneRef.set(null);
    this.showCloneFriends.set(false);
    this.collections.set([]);
    this.rssFeedUrl.set(null);
    this.isTwitter.set(false);
    this.twitterHandle.set(null);
    this.twitterError.set(null);
    this.isBluesky.set(false);
    this.bskyDid.set(null);
    this.bskyError.set(null);
    this.bskyFollowBusy.set(false);
    this.bskyCursor = null;
    this.tab.set('posts');
    if (id.startsWith('rss:')) {
      this.loadRss(id);
      return;
    }
    if (id.startsWith('bsky:')) {
      this.loadBluesky(id.slice('bsky:'.length));
      return;
    }
    if (id.startsWith('twitter:@')) {
      this.loadTwitter(id);
      return;
    }
    if (isElizaId(id)) {
      this.loadEliza();
      return;
    }
    if (isOpenRouterId(id)) {
      this.loadOpenRouter();
      return;
    }
    if (this.auth.isAnonymous && id === 'anonymous') {
      this.account.set(this.anonymous.account());
      this.statuses.set([]);
      this.pinnedStatuses.set([]);
      this.featured.set([]);
      this.loading.set(false);
      this.statusesLoading.set(false);
      this.exhausted.set(true);
      this.tab.set(
        this.route.snapshot.queryParamMap.get('tab') === 'following' ? 'following' : 'posts',
      );
      return;
    }
    const publicRef = parseAnonymousAccountRouteRef(id);
    if (publicRef) {
      this.loadAnonymousPublicProfile(publicRef);
      return;
    }
    this.routeLoadSub.add(
      this.api.getAccount(id).subscribe((a) => {
        this.account.set(a);
        if (this.auth.isAnonymous) {
          this.relationship.set(this.anonymousFollows.relationship(a, this.anonymous.server()));
        }
        this.loading.set(false);
      }),
    );
    this.loadStatuses(id);
    this.loadPinned(id);
    this.loadCollections(id);
    if (this.capabilities.canManageRelationships) {
      this.routeLoadSub.add(
        this.api.relationships([id]).subscribe((rels) => this.relationship.set(rels[0] ?? null)),
      );
    }
    this.loadFeatured(id);
  }

  private loadAnonymousPublicProfile(ref: AnonymousPublicRef): void {
    this.publicProfileRef = ref;
    this.cloneRef.set(ref);
    this.featured.set([]);
    this.routeLoadSub.add(
      this.anonymousPublic.getAccount(ref).subscribe({
        next: (account) => {
          this.account.set(account);
          this.relationship.set(this.anonymousFollows.relationship(account, ref.server));
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      }),
    );
    this.loadStatuses(ref.id);
    this.loadPinned(ref.id);
    this.loadCollections(ref.id);
  }

  /**
   * An RSS feed as a synthetic profile: the feed's account plus its items as the
   * timeline. No relationships, pinned, or featured — those are Mastodon-only.
   * Feeds have no pagination, so the whole feed loads at once (exhausted).
   */
  /**
   * A Twitter account as a profile: their posts, read through the configured data
   * service.
   *
   * Reuses this page rather than adding a screen of its own, exactly like the
   * RSS branch above — the whole architecture rests on foreign content becoming
   * ordinary `Status` objects, so a Twitter profile should need no special rendering.
   *
   * Two differences from every other profile here, both from the same cause
   * (there is no signed-in X user):
   *
   * - No relationships, pinned posts or featured tags. Those need an account.
   * - Loading costs money, so it is capped at one page and marked exhausted.
   *   Infinite scroll on a billed API is a way to spend a balance by accident.
   *
   * The profile itself is not fetched: the follow record already holds the
   * display name and avatar, and the posts carry the author. That saves one
   * billable request per visit for an account you already follow. Only an
   * *unfollowed* handle needs the lookup.
   */
  private loadTwitter(id: string): void {
    this.isTwitter.set(true);
    const handle = id.slice('twitter:@'.length);
    this.twitterHandle.set(handle);
    this.statuses.set([]);
    this.pinnedStatuses.set([]);
    this.featured.set([]);
    this.statusesLoading.set(true);
    // One page only; see the note above.
    this.exhausted.set(true);
    const seq = ++this.loadSeq;

    const follow = this.twitterFollows.find(handle);
    const known: Observable<TwitterFollow> = follow
      ? of(follow)
      : this.twitterApi.getProfile(handle).pipe(
          map(
            (account): TwitterFollow => ({
              username: account.username,
              displayName: account.display_name,
              avatar: account.avatar,
              addedAt: Date.now(),
              enabled: true,
            }),
          ),
          tap((resolved: TwitterFollow) => {
            if (seq === this.loadSeq) {
              this.account.set(twitterPlaceholderAccount(resolved));
            }
          }),
        );

    this.statusLoadSub = known
      .pipe(switchMap((resolved) => this.twitterFeed.timeline(resolved)))
      .subscribe({
        next: (statuses) => {
          if (seq !== this.loadSeq) {
            return;
          }
          // The author object off a real post beats anything synthesized: it
          // carries the live follower counts and bio.
          const authored = statuses.find(
            (status) => status.account.username.toLowerCase() === handle.toLowerCase(),
          );
          this.account.set(
            authored?.account ??
              this.account() ??
              twitterPlaceholderAccount(follow ?? fallbackFollow(handle)),
          );
          this.statuses.set(statuses);
          this.twitterStale.set(this.twitterFeed.isStale(handle));
          this.loading.set(false);
          this.statusesLoading.set(false);
          this.diagnostics.info('Profile', 'twitter:loaded', {
            handle,
            posts: statuses.length,
            stale: this.twitterStale(),
          });
        },
        error: (error: unknown) => {
          if (seq !== this.loadSeq) {
            return;
          }
          this.diagnostics.error('Profile', 'twitter:load-failed', error, { handle });
          // Show the account with its posts missing, and say why — rather than
          // letting the page fall through to "Account not found", which is a
          // different and wrong claim. A rate limit, an expired key or a dead
          // proxy all mean "we could not fetch the posts"; none of them mean the
          // account does not exist, and sending someone to check the handle they
          // typed is the least useful thing the page could do.
          this.account.set(
            this.account() ?? twitterPlaceholderAccount(follow ?? fallbackFollow(handle)),
          );
          this.twitterError.set(
            error instanceof Error ? error.message : `Could not load posts for @${handle}.`,
          );
          this.loading.set(false);
          this.statusesLoading.set(false);
        },
      });
  }

  /**
   * Fetch this Twitter account's posts again, at the cost of one request.
   *
   * The only path that spends money on this page. Deliberately a button rather
   * than anything automatic — see {@link twitterStale}.
   */
  protected refreshTwitter(): void {
    const handle = this.twitterHandle();
    if (!handle || this.statusesLoading()) {
      return;
    }
    this.twitterError.set(null);
    this.statusesLoading.set(true);
    const follow = this.twitterFollows.find(handle) ?? fallbackFollow(handle);
    const seq = ++this.loadSeq;
    this.statusLoadSub?.unsubscribe();
    this.statusLoadSub = this.twitterFeed.timeline(follow, true).subscribe({
      next: (statuses) => {
        if (seq !== this.loadSeq) {
          return;
        }
        this.statuses.set(statuses);
        this.twitterStale.set(false);
        this.statusesLoading.set(false);
      },
      error: (error: unknown) => {
        if (seq !== this.loadSeq) {
          return;
        }
        // The saved posts stay on screen. A failed refresh should cost the
        // reader the update, not the copy they were already reading.
        this.twitterError.set(
          error instanceof Error ? error.message : `Could not refresh @${handle}.`,
        );
        this.statusesLoading.set(false);
      },
    });
  }

  /** Follow or unfollow this Twitter account locally. Costs nothing either way. */
  protected toggleTwitterFollow(): void {
    const handle = this.twitterHandle();
    const account = this.account();
    if (!handle) {
      return;
    }
    if (this.twitterFollows.has(handle)) {
      this.twitterFollows.remove(handle);
      return;
    }
    this.twitterFollows.add({
      username: handle,
      displayName: account?.display_name ?? handle,
      avatar: account?.avatar,
    });
  }

  /**
   * A Bluesky account: the detailed profile plus its author feed.
   *
   * Two calls, deliberately. `getProfile` is the only thing that carries the bio,
   * banner, counts *and* `viewer.following` — the last of which is what the follow
   * button needs and what nothing else can supply on a cold load. The author feed
   * is a separate cursor-paged endpoint, so unlike the Twitter branch above this
   * one supports "load more" properly.
   *
   * The actor is addressed by the DID from the route rather than the handle:
   * handles are rentable and can change, DIDs cannot, so a bookmarked profile URL
   * keeps working after a rename.
   */
  private loadBluesky(did: string): void {
    this.isBluesky.set(true);
    this.bskyDid.set(did);
    this.statuses.set([]);
    this.pinnedStatuses.set([]);
    this.featured.set([]);
    this.statusesLoading.set(true);
    this.exhausted.set(false);
    const seq = ++this.loadSeq;

    if (!this.bskySession.linked()) {
      // Every app.bsky read here is authenticated; without a session there is
      // nothing to show and no useful error from the network.
      this.loading.set(false);
      this.statusesLoading.set(false);
      this.exhausted.set(true);
      this.bskyError.set('Link a Bluesky account in Settings → Connections to view this profile.');
      return;
    }

    this.routeLoadSub.add(
      this.bskyApi.getProfile(did).subscribe({
        next: (profile) => {
          if (seq !== this.loadSeq) {
            return;
          }
          this.account.set(adaptProfile(profile));
          this.relationship.set(adaptRelationship(profile));
          // Cache the follow record's uri so an unfollow costs one call, not two.
          this.bskyGraph.remember(profile.did, profile.viewer?.following);
          this.loading.set(false);
          this.diagnostics.info('Profile', 'bsky:loaded', { did, handle: profile.handle });
        },
        error: (error: unknown) => {
          if (seq !== this.loadSeq) {
            return;
          }
          this.diagnostics.error('Profile', 'bsky:load-failed', error, { did });
          this.loading.set(false);
          this.bskyError.set(
            error instanceof Error ? error.message : 'Could not load this Bluesky profile.',
          );
        },
      }),
    );

    this.loadBlueskyPosts(seq);
  }

  /** One page of the author feed; also serves "load more" via {@link bskyCursor}. */
  private loadBlueskyPosts(seq: number): void {
    const did = this.bskyDid();
    if (!did) {
      return;
    }
    this.statusLoadSub = this.bskyApi
      .getAuthorFeed(did, this.bskyCursor, this.bskyFilter())
      .subscribe({
        next: (page) => {
          if (seq !== this.loadSeq) {
            return;
          }
          this.bskyCursor = page.cursor ?? null;
          const statuses = page.feed.map(adaptFeedItem);
          this.statuses.update((current) => [...current, ...statuses]);
          // No cursor, or a page that added nothing: the history is complete.
          this.exhausted.set(!this.bskyCursor || statuses.length === 0);
          this.statusesLoading.set(false);
          this.loadingMore.set(false);
        },
        error: (error: unknown) => {
          if (seq !== this.loadSeq) {
            return;
          }
          this.diagnostics.error('Profile', 'bsky:posts-failed', error, { did });
          this.statusesLoading.set(false);
          this.loadingMore.set(false);
          this.exhausted.set(true);
          this.bskyError.set(
            error instanceof Error ? error.message : 'Could not load posts for this account.',
          );
        },
      });
  }

  private loadRss(id: string): void {
    this.isRss.set(true);
    const feedUrl = id.slice('rss:'.length);
    this.rssFeedUrl.set(feedUrl);
    this.statuses.set([]);
    this.pinnedStatuses.set([]);
    this.featured.set([]);
    this.statusesLoading.set(true);
    this.exhausted.set(true);
    const seq = ++this.loadSeq;
    this.statusLoadSub = this.rss.getFeed(feedUrl).subscribe({
      next: ({ account, statuses }) => {
        if (seq !== this.loadSeq) {
          return;
        }
        this.account.set(account);
        this.statuses.set(statuses);
        this.loading.set(false);
        this.statusesLoading.set(false);
        // One line per profile open. An empty feed that parsed is worth saying
        // out loud: it looks identical to a failure on screen.
        this.diagnostics.info('Profile', 'rss:loaded', {
          feed: feedUrl,
          items: statuses.length,
        });
      },
      error: (error: unknown) => {
        if (seq !== this.loadSeq) {
          return;
        }
        this.diagnostics.error('Profile', 'rss:load-failed', error, { feed: feedUrl });
        // No account to show; the template falls back to "Account not found".
        this.loading.set(false);
        this.statusesLoading.set(false);
      },
    });
  }

  /**
   * Eliza's synthetic profile: her account and pre-written timeline, served
   * entirely from {@link ElizaService} with no network call. Works identically
   * whether the viewer is anonymous or signed in — she's a browser-local friend.
   * Her follow relationship is the local one (never the real follow API).
   */
  private loadEliza(): void {
    this.eliza.refresh();
    this.account.set(this.eliza.account());
    const timeline = this.eliza.timeline();
    this.pinnedStatuses.set(this.showPinned() ? timeline.filter((s) => s.pinned) : []);
    this.statuses.set(timeline);
    this.featured.set([]);
    this.relationship.set(this.eliza.relationship());
    this.loading.set(false);
    this.statusesLoading.set(false);
    this.exhausted.set(true);
    this.tab.set('posts');
  }

  /**
   * OpenRouter's synthetic profile — the model you have configured, as a
   * correspondent.
   *
   * Deliberately empty of posts, and that is not a gap to fill later: a
   * language model has nothing to say until asked, so a feed of model-authored
   * posts would be words put in its mouth. The profile is the door to a
   * conversation, and the template's empty state says so.
   *
   * Left as "account not found" when AI is off or no key is connected. There is
   * genuinely nothing to show, and a profile for a service you cannot reach
   * would only raise a question the page cannot answer.
   */
  private loadOpenRouter(): void {
    if (!this.ai.enabled() || !this.openRouter.connected()) {
      this.loading.set(false);
      this.statusesLoading.set(false);
      return;
    }
    this.account.set(openRouterAccount(this.modelChoice.modelId()));
    this.statuses.set([]);
    this.pinnedStatuses.set([]);
    this.featured.set([]);
    this.relationship.set(null);
    this.loading.set(false);
    this.statusesLoading.set(false);
    this.exhausted.set(true);
    this.tab.set('posts');
  }

  toggleBoosts(): void {
    this.showBoosts.update((v) => !v);
    this.reloadStatuses();
  }

  toggleReplies(): void {
    this.showReplies.update((v) => !v);
    this.reloadStatuses();
  }

  togglePinned(): void {
    this.showPinned.update((v) => !v);
  }

  private reloadStatuses(): void {
    // Bluesky re-queries rather than re-filters: the replies toggle is a
    // different server-side filter, so the feed restarts from the newest post.
    if (this.isBluesky()) {
      this.bskyCursor = null;
      this.statuses.set([]);
      this.statusesLoading.set(true);
      this.loadBlueskyPosts(++this.loadSeq);
      return;
    }
    const id = this.publicProfileRef?.id ?? this.account()?.id;
    if (id) {
      this.loadStatuses(id);
    }
  }

  /** How many statuses a filtered profile view should end up with. */
  private static readonly TARGET_COUNT = 20;
  /** Safety cap on the fetch-until-full loop (filtered pages can come back short). */
  private static readonly MAX_PAGES = 8;

  /**
   * Load the account's statuses under the current filter toggles. Mastodon
   * applies exclude_* filtering per page, so filtered pages can return fewer
   * than `limit` items — keep paging older until TARGET_COUNT accumulate,
   * the account runs out, or MAX_PAGES is hit.
   */
  private loadStatuses(id: string): void {
    this.statusLoadSub.unsubscribe();
    this.statusLoadSub = new Subscription();
    const seq = ++this.loadSeq;
    this.loadBlogStatuses(id, seq);
    this.statuses.set([]);
    this.statusesLoading.set(true);
    this.exhausted.set(false);
    const opts = {
      excludeReblogs: !this.showBoosts(),
      excludeReplies: !this.showReplies(),
      limit: Profile.TARGET_COUNT,
    };
    const fetchPage = (maxId: string | undefined, acc: Status[], page: number): void => {
      this.statusLoadSub.add(
        this.getAccountStatuses(id, { ...opts, maxId }).subscribe({
          next: (batch) => {
            if (seq !== this.loadSeq) {
              return; // A newer load superseded this one.
            }
            const all = [...acc, ...batch];
            if (batch.length > 0 && all.length < Profile.TARGET_COUNT && page < Profile.MAX_PAGES) {
              fetchPage(this.nativeStatusId(batch[batch.length - 1]), all, page + 1);
              return;
            }
            this.statuses.set(all);
            this.statusesLoading.set(false);
          },
          error: () => {
            if (seq === this.loadSeq) {
              this.statuses.set(acc);
              this.statusesLoading.set(false);
            }
          },
        }),
      );
    };
    fetchPage(undefined, [], 1);
  }

  /** Load the configured Mataroa RSS feed only on this account's own profile. */
  private loadBlogStatuses(id: string, seq: number): void {
    const feedUrl = this.mataroa.feedUrl();
    const account = this.auth.account();
    if (!feedUrl || !account || id !== account.id || !this.mataroa.includeInProfile()) {
      this.blogStatuses.set([]);
      return;
    }
    this.statusLoadSub.add(
      this.rss.getFeed(feedUrl, true).subscribe({
        next: ({ statuses }) => {
          if (seq !== this.loadSeq) {
            return;
          }
          // This is the user's profile feed, so blog entries retain RSS behavior
          // while presenting the same identity as the Mastodon posts beside them.
          this.blogStatuses.set(statuses.map((status) => ({ ...status, account })));
        },
        error: (error: unknown) => {
          if (seq === this.loadSeq) {
            this.blogStatuses.set([]);
            this.diagnostics.warn('Profile', 'mataroa-rss:load-failed', {
              feed: feedUrl,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    );
  }

  /** Fetch one older page below the current list ("Load more" at the bottom). */
  loadMore(): void {
    if (this.isBluesky()) {
      if (this.loadingMore() || this.exhausted() || !this.bskyCursor) {
        return;
      }
      this.loadingMore.set(true);
      this.loadBlueskyPosts(this.loadSeq);
      return;
    }
    const id = this.publicProfileRef?.id ?? this.account()?.id;
    const last = this.statuses().at(-1);
    if (!id || !last || this.loadingMore() || this.exhausted()) {
      return;
    }
    const seq = this.loadSeq;
    this.loadingMore.set(true);
    this.getAccountStatuses(id, {
      excludeReblogs: !this.showBoosts(),
      excludeReplies: !this.showReplies(),
      limit: Profile.TARGET_COUNT,
      maxId: this.nativeStatusId(last),
    }).subscribe({
      next: (batch) => {
        this.loadingMore.set(false);
        if (seq !== this.loadSeq) {
          return; // Filters changed or the route moved mid-flight.
        }
        if (!batch.length) {
          this.exhausted.set(true);
          return;
        }
        const seen = new Set(this.statuses().map((s) => s.id));
        this.statuses.update((list) => [...list, ...batch.filter((s) => !seen.has(s.id))]);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  private loadPinned(id: string): void {
    this.pinnedStatuses.set([]);
    this.routeLoadSub.add(
      this.getAccountStatuses(id, { pinned: true }).subscribe({
        next: (pinned) => this.pinnedStatuses.set(pinned),
        error: () => {
          // No pinned strip, the rest of the profile still works.
        },
      }),
    );
  }

  private getAccountStatuses(id: string, opts: AccountStatusesOptions): Observable<Status[]> {
    return this.publicProfileRef
      ? this.anonymousPublic.getAccountStatuses({ ...this.publicProfileRef, id }, opts)
      : this.api.getAccountStatuses(id, opts);
  }

  private nativeStatusId(status: Status): string {
    const ref = status.providerRef as Partial<AnonymousProviderRef> | undefined;
    return status.provider === 'anonymous-mastodon' && typeof ref?.statusId === 'string'
      ? ref.statusId
      : status.id;
  }

  private loadFeatured(id: string): void {
    this.featured.set([]);
    this.featuredFollowing.set(new Set());
    this.routeLoadSub.add(
      this.api.accountEndorsements(id).subscribe({
        next: (accounts) => {
          this.featured.set(accounts);
          if (!accounts.length) {
            return;
          }
          if (this.auth.isAnonymous) {
            this.featuredFollowing.set(
              new Set(
                accounts
                  .filter((account) =>
                    this.anonymousFollows.isFollowing(account, this.anonymous.server()),
                  )
                  .map((account) => account.id),
              ),
            );
            return;
          }
          if (!this.capabilities.canManageRelationships) {
            return;
          }
          this.routeLoadSub.add(
            this.api.relationships(accounts.map((a) => a.id)).subscribe({
              next: (rels) =>
                this.featuredFollowing.set(
                  new Set(rels.filter((r) => r.following || r.requested).map((r) => r.id)),
                ),
              error: () => {
                // Follow buttons just show for everyone; following again is harmless.
              },
            }),
          );
        },
        error: () => {
          // Older servers (pre-4.4) 404 here; the section simply doesn't render.
        },
      }),
    );
  }

  /** Load actual Mastodon Collections, distinct from legacy profile endorsements. */
  private loadCollections(id: string): void {
    this.collections.set([]);
    const request = this.publicProfileRef
      ? this.anonymousPublic.getAccountCollections({ ...this.publicProfileRef, id })
      : this.api.accountCollections(id);
    this.routeLoadSub.add(
      request.subscribe({
        next: (collections) => this.collections.set(collections),
        error: () => {
          // Collections were added in Mastodon 4.6; older and non-Mastodon servers may not support them.
        },
      }),
    );
  }

  followFeatured(target: Account): void {
    if (this.auth.isAnonymous) {
      const result = this.anonymousFollows.follow(
        target,
        this.publicProfileRef?.server ?? this.anonymous.server(),
      );
      if (result.ok) {
        this.featuredFollowing.update((set) => new Set(set).add(target.id));
        this.followError.set(null);
      } else {
        this.followError.set(result.error);
      }
      return;
    }
    this.api.follow(target.id).subscribe((rel) => {
      if (rel.following || rel.requested) {
        this.featuredFollowing.update((s) => new Set(s).add(target.id));
      }
    });
  }

  /** Follow every featured account the viewer doesn't already follow, one at a time. */
  async followAllFeatured(): Promise<void> {
    if (this.featuredBusy()) {
      return;
    }
    this.featuredBusy.set(true);
    try {
      for (const target of this.featuredToFollow()) {
        if (this.auth.isAnonymous) {
          const result = this.anonymousFollows.follow(target, this.anonymous.server());
          if (!result.ok) {
            this.followError.set(result.error);
            break;
          }
          this.featuredFollowing.update((set) => new Set(set).add(target.id));
          continue;
        }
        try {
          const rel = await firstValueFrom(this.api.follow(target.id));
          if (rel.following || rel.requested) {
            this.featuredFollowing.update((s) => new Set(s).add(target.id));
          }
        } catch {
          // Keep going; one failed follow shouldn't abort the batch.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      this.featuredBusy.set(false);
    }
  }

  toggleFollow(): void {
    const acc = this.account();
    const rel = this.relationship();
    if (!acc) {
      return;
    }
    this.followError.set(null);
    if (isElizaId(acc.id)) {
      if (rel?.following) {
        this.eliza.unfollow();
      } else {
        this.eliza.follow();
      }
      this.relationship.set(this.eliza.relationship());
      return;
    }
    if (this.auth.isAnonymous) {
      if (rel?.following) {
        this.relationship.set(
          this.anonymousFollows.unfollow(
            acc,
            this.publicProfileRef?.server ?? this.anonymous.server(),
          ),
        );
        return;
      }
      const result = this.anonymousFollows.follow(
        acc,
        this.publicProfileRef?.server ?? this.anonymous.server(),
      );
      this.relationship.set(result.relationship);
      if (!result.ok) {
        this.followError.set(result.error);
      }
      return;
    }
    const call = rel?.following ? this.api.unfollow(acc.id) : this.api.follow(acc.id);
    call.subscribe((updated) => this.relationship.set(updated));
  }

  requestUnfollow(): void {
    this.showUnfollowConfirm.set(true);
  }

  confirmUnfollow(): void {
    this.showUnfollowConfirm.set(false);
    this.toggleFollow();
  }

  requestRemoveFollower(): void {
    this.showRemoveFollowerConfirm.set(true);
  }

  confirmRemoveFollower(): void {
    const acc = this.account();
    if (!acc || !this.capabilities.canManageRelationships) {
      return;
    }
    this.showRemoveFollowerConfirm.set(false);
    this.api.removeFollower(acc.id).subscribe((updated) => this.relationship.set(updated));
  }

  toggleAccountBoosts(): void {
    const acc = this.account();
    const rel = this.relationship();
    if (!acc || !rel?.following || !this.capabilities.canManageRelationships) {
      return;
    }
    const show = rel.showing_reblogs === false;
    this.api
      .follow(acc.id, { reblogs: show })
      .subscribe((updated) => this.relationship.set(updated));
  }

  /** Mute duration presets (seconds; null = until unmuted). */
  protected readonly muteDurations: { label: string; seconds: number | null }[] = [
    { label: '1 hour', seconds: 3600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: 'forever', seconds: null },
  ];

  /**
   * Whether relationship actions go through the local client-side store instead
   * of the server API: always for Anonymous (no write scope, read-only public
   * API), and for any viewer the server can't manage relationships for.
   */
  protected get useLocalModeration(): boolean {
    // A linked Bluesky session can write real blocks and mutes on its own
    // network, so those do not fall back to the browser-local store.
    if (this.useBlueskyModeration) {
      return false;
    }
    return this.auth.isAnonymous || !this.capabilities.canManageRelationships;
  }

  /** Local block/mute state, re-read through the moderation signal. */
  protected localBlocked = computed(() => {
    this.localMod.entries();
    const acc = this.account();
    return !!acc && this.localMod.isBlocked(acc);
  });
  protected localMuted = computed(() => {
    this.localMod.entries();
    const acc = this.account();
    return !!acc && this.localMod.isMuted(acc);
  });

  /**
   * Server-side moderation on Bluesky, where the account lives.
   *
   * Checked before `useLocalModeration` because a linked Bluesky session *can*
   * write these — a real block that the other account sees — while the local
   * store only hides things in this browser. Without a session it falls through
   * to local moderation, which still works and is the honest option.
   */
  private get useBlueskyModeration(): boolean {
    return this.isBluesky() && this.bskySession.linked();
  }

  /** Merge a one-dimension relationship patch onto what the page already holds. */
  private patchRelationship(patch: Relationship): void {
    this.relationship.update((current) => ({ ...current, ...patch }));
  }

  mute(seconds: number | null): void {
    const acc = this.account();
    if (!acc) {
      return;
    }
    if (this.useBlueskyModeration) {
      // Bluesky mutes have no duration; a timed mute stays local so the "for 5
      // minutes" choice keeps meaning what it says.
      if (seconds !== null) {
        this.localMod.mute(acc, seconds);
        return;
      }
      this.bskyGraph
        .mute(this.bskyDid() ?? '')
        .subscribe({ next: (rel) => this.patchRelationship(rel) });
      return;
    }
    if (this.useLocalModeration) {
      this.localMod.mute(acc, seconds);
      return;
    }
    this.api
      .muteAccount(acc.id, seconds ?? undefined)
      .subscribe((updated) => this.relationship.set(updated));
  }

  unmute(): void {
    const acc = this.account();
    if (!acc) {
      return;
    }
    if (this.useBlueskyModeration) {
      // Clear both: a local timed mute and a server mute can coexist.
      this.localMod.clear(acc);
      this.bskyGraph
        .unmute(this.bskyDid() ?? '')
        .subscribe({ next: (rel) => this.patchRelationship(rel) });
      return;
    }
    if (this.useLocalModeration) {
      this.localMod.clear(acc);
      return;
    }
    this.api.unmuteAccount(acc.id).subscribe((updated) => this.relationship.set(updated));
  }

  toggleBlock(): void {
    const acc = this.account();
    const rel = this.relationship();
    if (!acc) {
      return;
    }
    if (this.useBlueskyModeration) {
      const did = this.bskyDid() ?? '';
      const call = rel?.blocking ? this.bskyGraph.unblock(did) : this.bskyGraph.block(did);
      call.subscribe({
        next: (updated) => this.patchRelationship(updated),
        error: (error: unknown) =>
          this.bskyError.set(
            error instanceof Error ? error.message : 'Could not update the block on Bluesky.',
          ),
      });
      return;
    }
    if (this.useLocalModeration) {
      if (this.localMod.isBlocked(acc)) {
        this.localMod.clear(acc);
      } else {
        this.localMod.block(acc);
      }
      return;
    }
    const call = rel?.blocking ? this.api.unblockAccount(acc.id) : this.api.block(acc.id);
    call.subscribe((updated) => this.relationship.set(updated));
  }

  requestBlock(): void {
    const alreadyBlocked = this.useLocalModeration
      ? this.localBlocked()
      : this.relationship()?.blocking;
    if (alreadyBlocked) {
      this.toggleBlock();
      return;
    }
    this.showBlockConfirm.set(true);
  }

  confirmBlock(): void {
    this.showBlockConfirm.set(false);
    this.toggleBlock();
  }

  onChanged(updated: Status): void {
    this.statuses.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
    this.pinnedStatuses.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
    this.pinnedStatuses.update((list) => list.filter((s) => s.id !== removed.id));
  }

  onReported(): void {
    this.showReport.set(false);
    this.reportDone.set(true);
  }
}

/**
 * A minimal `Account` for a Twitter profile we know the handle of but have not yet
 * seen a post from.
 *
 * Used only as a placeholder while the timeline loads, and replaced by the real
 * author object as soon as one post arrives — that one carries live follower
 * counts and the bio, which this cannot. It exists so the page has a name and
 * avatar to render immediately instead of flashing "Account not found".
 */
function twitterPlaceholderAccount(follow: {
  username: string;
  displayName: string;
  avatar?: string;
}): Account {
  return {
    id: `twitter:@${follow.username}`,
    username: follow.username,
    acct: `${follow.username}@x.com`,
    display_name: follow.displayName || follow.username,
    note: '',
    url: `https://x.com/${follow.username}`,
    avatar: follow.avatar ?? '',
    avatar_static: follow.avatar ?? '',
    header: '',
    header_static: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    fields: [],
  };
}

/** The bare minimum needed to fetch a handle nobody follows yet. */
function fallbackFollow(handle: string) {
  return { username: handle, displayName: handle, addedAt: Date.now(), enabled: true };
}
