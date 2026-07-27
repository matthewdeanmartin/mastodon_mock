import { computed, inject, Injectable, signal } from '@angular/core';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { Terminology } from '../../../terminology';
import { AnonymousAccount } from '../../../providers/anonymous/anonymous-account';
import { AnonymousFollows } from '../../../providers/anonymous/anonymous-follows';
import { AnonymousTags } from '../../../providers/anonymous/anonymous-tags';
import { BlueskyApi } from '../../../providers/bluesky/bluesky-api';
import { BlueskySession } from '../../../providers/bluesky/bluesky-session';
import { BskyProfile } from '../../../providers/bluesky/bluesky-types';
import { RailProfile } from './rail-profile';

/** Where the local identity's card sits when it isn't the active one. */
const MOCKINGBIRD_BADGE = '🎭';

/**
 * Assembles the left rail's stack of identity cards — one per network the
 * browser is connected to.
 *
 * This is a service rather than logic inside the card component because the set
 * of identities is a property of the session, not of one widget: a future
 * network joins the stack by adding a branch here, and every consumer (the rail,
 * the account menu, whatever comes next) sees it. The counts that only the
 * client knows — the Anonymous identity's follows and followed hashtags — are
 * gathered here too, so the component stays presentation.
 */
@Injectable({ providedIn: 'root' })
export class RailProfiles {
  private auth = inject(Auth);
  private api = inject(Api);
  private anonymous = inject(AnonymousAccount);
  private anonymousFollows = inject(AnonymousFollows);
  private anonymousTags = inject(AnonymousTags);
  private blueskySession = inject(BlueskySession);
  private blueskyApi = inject(BlueskyApi);
  private words = inject(Terminology).words;

  private hashtagCount = signal(0);
  private blueskyProfile = signal<BskyProfile | null>(null);
  private loaded = false;

  /** Follows for the active identity; the server's figure, or the local one. */
  readonly followingCount = computed(() =>
    this.auth.isAnonymous
      ? this.anonymousFollows.count()
      : (this.auth.account()?.following_count ?? 0),
  );

  /**
   * The stack, back to front: peeking tabs keep this order and the selected card
   * is the one that opens. The active identity leads — it is the one the app is
   * posting as, so it should be the card sitting there on first load.
   */
  readonly profiles = computed<RailProfile[]>(() => {
    const cards: RailProfile[] = [];
    const active = this.auth.account();
    if (active) {
      const anonymousActive = this.auth.isAnonymous;
      cards.push({
        key: anonymousActive ? 'anonymous' : `mastodon:${active.id}`,
        badge: anonymousActive ? MOCKINGBIRD_BADGE : '🐘',
        network: anonymousActive ? 'Local' : 'Mastodon',
        displayName: active.display_name || active.username,
        handle: active.username,
        avatar: active.avatar_static || active.avatar,
        header: active.header_static || active.header,
        bioHtml: active.note || undefined,
        stats: [
          {
            label: this.words().Posts,
            value: active.statuses_count,
            link: ['/accounts', active.id],
          },
          { label: 'Following', value: this.followingCount(), link: ['/accounts', active.id] },
          { label: 'Followers', value: active.followers_count, link: ['/accounts', active.id] },
          { label: 'Hashtags', value: this.hashtagCount(), link: ['/feeds/tags'] },
        ],
        link: ['/accounts', active.id],
        account: active,
        active: true,
      });
    }
    const bsky = this.blueskySession.session();
    if (bsky) {
      const profile = this.blueskyProfile();
      cards.push({
        key: `bluesky:${bsky.did}`,
        badge: '🦋',
        network: 'Bluesky',
        displayName: profile?.displayName || bsky.displayName || bsky.handle,
        handle: bsky.handle,
        avatar: profile?.avatar || bsky.avatar,
        header: profile?.banner,
        bioText: profile?.description || undefined,
        // Counts only exist once getProfile has answered; an empty row beats
        // four zeroes that look like a real (and wrong) tally.
        stats: profile
          ? [
              { label: this.words().Posts, value: profile.postsCount ?? 0 },
              { label: 'Following', value: profile.followsCount ?? 0 },
              { label: 'Followers', value: profile.followersCount ?? 0 },
            ]
          : [],
        href: `https://bsky.app/profile/${bsky.handle}`,
        active: false,
      });
    }
    // The browser-local identity, when it exists but isn't the one in use. Its
    // counts are client-side and unscoped, so they are right either way.
    if (!this.auth.isAnonymous && this.anonymous.activated()) {
      const local = this.anonymous.account();
      cards.push({
        key: 'anonymous',
        badge: MOCKINGBIRD_BADGE,
        network: 'Local',
        displayName: local.display_name || local.username,
        handle: local.username,
        avatar: local.avatar_static || local.avatar,
        header: local.header_static || local.header,
        bioHtml: local.note || undefined,
        stats: [
          { label: 'Following', value: this.anonymousFollows.count() },
          { label: 'Hashtags', value: this.anonymousTags.count() },
        ],
        active: false,
        switchTo: 'anonymous',
      });
    }
    return cards;
  });

  /**
   * Fetch the figures the cards can't derive locally. Safe to call repeatedly —
   * the rail is rebuilt on every navigation, and these are once-per-session.
   */
  load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    if (this.auth.isAnonymous) {
      this.hashtagCount.set(this.anonymousTags.count());
    } else {
      this.api.followedTags().subscribe({
        next: (tags) => this.hashtagCount.set(tags.length),
        error: () => this.hashtagCount.set(0),
      });
    }
    if (this.blueskySession.linked()) {
      this.blueskyApi.getProfile().subscribe({
        next: (profile) => this.blueskyProfile.set(profile),
        error: () => {
          // Sidebar widget: the card still renders from the stored session.
        },
      });
    }
  }
}
