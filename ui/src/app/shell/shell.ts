import { Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NgOptimizedImage } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Api } from '../api';
import { AccountChoice, Auth, Session } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { BotPeers } from '../chat/bot-peers';
import { environment } from '../../environments/environment';
import { brandLogoSrc, isCanaryBuild, isTestBuild } from '../build-flavor';
import { Hotkeys } from '../hotkeys';
import { ShortcutHelp } from '../shortcut-help/shortcut-help';
import { AppFooter } from './app-footer/app-footer';
import { LeftRail } from './left-rail/left-rail';
import { RightRail } from './right-rail/right-rail';
import { ServerAbout } from '../server-about';
import { FeatureFlags } from '../feature-flags';
import { PosseQueue } from '../providers/hugo/posse-queue';
import { LeaveChoice, LeaveDialog } from '../leave-dialog/leave-dialog';
import { WritingZen } from '../writing-zen';
import { ReadingZen } from '../reading-zen';
import { FirstRunChoice, FirstRunModal } from '../first-run/first-run-modal';
import { PreviewSeed } from '../first-run/preview-seed';
import { PlusBadgeEntitlement } from '../providers/account/plus-badge-entitlement';
import { PLUS_PRICE_USD_PER_YEAR, visiblePlusBenefits } from '../plus-benefits';

function isWideUrl(url: string): boolean {
  // /search goes rails-off wide so facets have room to live beside results.
  // /write does too, and for the mirror-image reason: it spends the width on
  // drafts and notes instead of on trending tags and people to follow.
  // /rss is a two-pane reader: its own left rail of subscriptions would be
  // competing with the shell's rails for the same edge of the screen.
  return (
    url.startsWith('/settings') ||
    url.startsWith('/conversations') ||
    url.startsWith('/search') ||
    url.startsWith('/write') ||
    url.startsWith('/rss')
  );
}

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LeftRail,
    RightRail,
    AppFooter,
    ShortcutHelp,
    NgOptimizedImage,
    LeaveDialog,
    FirstRunModal,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell implements OnInit {
  protected auth = inject(Auth);
  private bots = inject(BotPeers);
  private preview = inject(PreviewSeed);

  /**
   * Whether an anonymous visitor has anyone to chat with.
   *
   * Anonymous accounts cannot reach the real chat API, so the entry is worth
   * showing only when a browser-local correspondent exists. In practice that
   * is always true while AI is on, because Eliza is unconditional — but the
   * check is against the peer list rather than assuming so, since that list is
   * the thing the page actually renders. It is also what a future bot (a docs
   * search bot, say) would add itself to.
   */
  protected hasLocalChat = computed(() => this.bots.peers().length > 0);
  private api = inject(Api);
  private router = inject(Router);
  /** Mastodon-compatible keyboard shortcuts (and the "?" help dialog). */
  protected hotkeys = inject(Hotkeys);
  protected prefs = inject(ClientPrefs);
  /**
   * Writing zen, which hides the header and footer too — those are shell-owned
   * and outside the router outlet, so /write cannot hide them by itself. This is
   * a different feature from `prefs.zenMode` (see {@link WritingZen}); writing
   * zen hides a strict superset, so the two are safe to have on at once.
   */
  protected writingZen = inject(WritingZen);
  /**
   * Reading zen: reader mode's transient hold on the rails. ORed with the saved
   * preference below rather than writing it, so opening an article never
   * reconfigures the app for someone who had zen on — or off — already.
   */
  protected readingZen = inject(ReadingZen);

  /** Rails hidden: the saved preference, or a reader-mode hold. */
  protected readonly railsHidden = computed(() => this.prefs.zenMode() || this.readingZen.active());
  protected serverAbout = inject(ServerAbout);
  protected featureFlags = inject(FeatureFlags);
  /** POSSE queue depth, for the "Waiting to publish" row and its count. */
  protected posse = inject(PosseQueue);

  /** Build flavor: drives the brand and whether mock-only nav links are shown. */
  protected mockTooling = environment.mockTooling;
  /** Canary deployments (/canary/ base href) show a distinct name, mark, accent. */
  protected isCanary = isCanaryBuild();
  /**
   * Test deployments (/test/ base href) say so, loudly and permanently.
   *
   * Unlike canary — which is production, for real customers, with new features
   * — /test/ talks to the sandbox Worker and sandbox Stripe. Nothing bought
   * there is real, so it must never be mistakable for the app that takes money.
   */
  protected isTest = isTestBuild();
  protected brand = environment.brand;
  protected deploymentLabel = this.isCanary ? 'Canary' : this.isTest ? 'Test' : null;
  /** Recomputed so switching illustration sets repaints the mark without a reload. */
  protected logoSrc = computed(() => brandLogoSrc(this.prefs.artStyle()));
  /** The header's account plan badge, settled without eagerly bundling account services. */
  protected plusBadge = inject(PlusBadgeEntitlement);
  /** Same source of truth as the Plus settings page; feature-flagged rows stay honest. */
  protected plusBenefits = computed(() =>
    visiblePlusBenefits((flag) => this.featureFlags.enabled(flag)),
  );
  protected readonly plusPriceUsd = PLUS_PRICE_USD_PER_YEAR;

  /** Whether the current account holds a staff role (drives the Admin nav link). */
  protected isStaff = computed(() => {
    const role = this.auth.account()?.role;
    return !!role && role.name !== '';
  });

  /** Settings and chat take the full width below the top bar (no rails), like 2018 Twitter. */
  protected wide = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => isWideUrl(this.router.url)),
    ),
    { initialValue: isWideUrl(this.router.url) },
  );

  /**
   * The routed column, which takes focus after each navigation.
   *
   * Angular swaps the outlet's contents but leaves focus where it was —
   * usually the nav link that was just activated. A screen reader user would
   * hear nothing and stay parked in the navbar, so moving focus to the top of
   * the new page is what actually makes the navigation perceivable. It also
   * puts Tab back at the start of the content rather than mid-navbar.
   */
  private readonly mainColumn = viewChild<ElementRef<HTMLElement>>('mainColumn');

  constructor() {
    // Not in ngOnInit: that returns early for anonymous visitors, and route
    // focus has to work for them too.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        // The outlet renders during navigation, but the new component's own
        // view may not be committed yet; wait a tick so focus lands on a
        // <main> that already holds the new page.
        setTimeout(() => this.focusMain());
      });
  }

  /** The leave/log-out confirmation, which also offers to erase browser data. */
  protected showLeave = signal(false);

  /**
   * Whether the first-run modal is up.
   *
   * Read once at construction rather than as a live signal: the preview flag is
   * plain `localStorage`, and re-reading it mid-session would let an unrelated
   * write re-open a modal the visitor has already answered.
   */
  private firstRunActive = signal(this.preview.active);
  protected firstRun = this.firstRunActive.asReadonly();

  /**
   * The visitor answered. Clear the seed, then go where they asked.
   *
   * The seed is cleared on **every** path, not just "continue" — someone who
   * signs in with Mastodon must not discover an anonymous account carrying
   * three follows they never chose. `clear()` skips any of the three they
   * genuinely followed while the preview was up.
   *
   * The login paths use `location.assign` for the same reason account switching
   * does: services cache storage-backed state in signals at construction, so a
   * soft navigation would leave `AnonymousFollows` serving follows that are no
   * longer in storage.
   */
  protected answerFirstRun(choice: FirstRunChoice): void {
    this.preview.clear();
    this.firstRunActive.set(false);
    if (choice === 'anonymous') {
      // Safe now: the app is theirs to navigate. `start()` is idempotent.
      this.hotkeys.start();
      return;
    }
    // Leave Anonymous so the login page opens signed-out, exactly as the
    // header's own Log in button does.
    this.auth.exitAnonymous();
    location.assign(choice === 'bluesky' ? 'login/bluesky' : 'login/mastodon');
  }

  /**
   * Move focus into the routed column.
   *
   * Shared by the skip link and the post-navigation effect. `<main>` carries
   * `tabindex="-1"` so it can accept focus programmatically without joining the
   * tab order; `preventScroll` because the router's own scroll restoration has
   * already decided where the page should sit.
   */
  protected focusMain(): void {
    this.mainColumn()?.nativeElement.focus({ preventScroll: true });
  }

  /**
   * Skip-link activation.
   *
   * The href stays `#main` so the control degrades to a real anchor and shows
   * a sane target in the status bar, but the router would treat a bare
   * fragment navigation as a route change, so move focus directly instead.
   */
  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.focusMain();
  }

  /** Transient, non-blocking message (e.g. a failed account switch). null = hidden. */
  protected toast = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => this.toast.set(null), 6000);
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  /**
   * A saved account whose token its instance rejected, from either a failed
   * switch or a failed verify on boot. In both cases the token has been cleared,
   * so it is *not* the active account — which is exactly why this has to exist.
   * The account menu's Log out acts on the active account, so without an
   * explicit escape the user could neither enter the broken account nor remove it.
   */
  protected deadSession = signal<AccountChoice | null>(null);

  /** Human label for the stuck account, for the dialog copy. */
  protected deadSessionName = computed(() => {
    const s = this.deadSession();
    return s?.account?.display_name || s?.account?.username || 'That account';
  });

  protected deadSessionServer = computed(() => {
    const s = this.deadSession();
    return s?.server ? s.server.replace(/^https?:\/\//, '') : 'this server';
  });

  /**
   * Close the dialog. If the failure happened on boot there is no signed-in
   * account behind it, so dismissing has to land somewhere usable rather than
   * leaving a logged-out shell rendering empty feeds.
   */
  protected dismissDeadSession(): void {
    this.deadSession.set(null);
    if (!this.auth.isAuthenticated) {
      location.assign('login');
    }
  }

  /**
   * Sign in again to refresh the rejected token. The failed switch already
   * restored that session's instance, so the login page opens pointed at the
   * right host; ?add=1 stops it bouncing a signed-in user home.
   */
  protected reauthenticate(): void {
    const session = this.deadSession();
    if (!session?.token) {
      return;
    }
    // Re-point at the dead session's instance without activating its token, so
    // the login page offers the host the account actually belongs to.
    this.auth.prepareReauth(session.token);
    // Straight to the Mastodon page, past the network chooser: the account being
    // re-authenticated is a Mastodon one, so there is nothing to choose.
    location.assign('login/mastodon?add=1');
  }

  /** Give up on the stuck account and drop it from the switcher. */
  protected forgetDeadSession(): void {
    const session = this.deadSession();
    if (!session?.token) {
      return;
    }
    this.auth.removeSession(session.token);
    this.deadSession.set(null);
    if (!this.auth.isAuthenticated) {
      // Boot-failure case: that was the only account, so there is nothing to
      // stay signed in as.
      location.assign('login');
      return;
    }
    // removeSession only touches the active account if it *was* active; it isn't
    // here, so the current identity is untouched and no reload is needed.
    this.showToast('Removed that account. Nothing else changed.');
  }

  /** Optional server links are discovered only when the user opens More. */
  onMoreToggle(event: Event): void {
    if ((event.currentTarget as HTMLDetailsElement).open) {
      this.serverAbout.load();
    }
  }

  ngOnInit(): void {
    // Independent of the Mastodon identity below. A Mawkingbird subscription
    // can exist while browsing anonymously or through Bluesky, and the header
    // must still settle its own account tier before claiming it is Free.
    void this.plusBadge.check();
    // Not while the first-run modal is blocking. The shortcuts are global and
    // navigational — "g" then "h" would move the app *behind* a modal the
    // visitor cannot dismiss, leaving them looking at a question about a page
    // that is no longer there. Started in `answerFirstRun` instead.
    if (!this.firstRunActive()) {
      this.hotkeys.start();
    }
    // Bluesky-primary excluded alongside Anonymous: this gates a Mastodon
    // `verify_credentials` call, and such an account has no Mastodon token to
    // verify. Reaching the call below without one fails, and the error branch
    // calls `exitToLoggedOut()` — so before this, a Bluesky-primary session
    // signed itself out on every single boot.
    if (this.auth.isAnonymous || this.auth.isBlueskyPrimary) {
      return;
    }
    if (!this.auth.account()) {
      this.api.verifyCredentials().subscribe({
        next: (acc) => this.auth.setAccount(acc),
        error: () => {
          // The stored token was rejected on boot. Don't silently delete the
          // account: offer the same reauthenticate/remove choice as a failed
          // switch. The dead token is the *active* one here, so clear it (every
          // request would 401) while leaving the saved session intact.
          const token = this.auth.token();
          const session = token
            ? (this.auth.sessions().find((s) => s.token === token) ?? null)
            : null;
          this.auth.exitToLoggedOut();
          if (!session) {
            // Nothing saved to reauthenticate against — the old behaviour is right.
            location.assign('login');
            return;
          }
          this.deadSession.set({
            key: `mastodon:${session.id}`,
            kind: 'mastodon',
            token: session.token,
            server: session.server ?? '',
            account: session.account,
          });
        },
      });
    }
  }

  /**
   * Switch to a saved account, then re-verify it before committing. A soft route
   * refresh isn't enough: nearly every widget (feeds, prefs, RSS/Bluesky, the
   * observability metrics) is scoped to the active account, and some read their
   * account-scoped storage at construction. So once the new token verifies, we
   * do a full page reload — the cleanest way to invalidate everything and
   * re-bootstrap against the new identity.
   */
  switchTo(target: AccountChoice | Session): void {
    const session: AccountChoice =
      'kind' in target
        ? target
        : {
            key: `mastodon:${target.id}`,
            kind: 'mastodon',
            token: target.token,
            server: target.server ?? '',
            account: target.account,
          };
    // Anonymous and Bluesky-primary are both tokenless identities: there is no
    // `verify_credentials` to run, so the switch is committed immediately and the
    // reload rebuilds everything account-scoped (including `BlueskySession`,
    // which picks the identity or connector keys at construction). Without this,
    // a Bluesky choice fell through to the token comparison below, matched
    // null === null, and returned having done nothing at all.
    if (session.kind === 'anonymous' || session.kind === 'bluesky') {
      if (this.auth.switchAccount(session)) {
        location.reload();
      }
      return;
    }
    const previous = this.auth.token();
    const previousWasAnonymous = this.auth.isAnonymous;
    // Remembered for the revert path below: a failed switch away from a
    // tokenless identity has no token to restore, and `exitToLoggedOut()` would
    // strand the user signed out of an account that was working a moment ago.
    const previousWasBluesky = this.auth.isBlueskyPrimary;
    if (session.token === previous) {
      return;
    }
    if (!session.token) {
      return;
    }
    this.auth.switchTo(session.token);
    this.api.verifyCredentials().subscribe({
      next: (acc) => {
        this.auth.setAccount(acc);
        // Hard reload: rebuild the whole app under the new account.
        location.reload();
      },
      error: () => {
        // The token was rejected by its instance. Don't silently delete the account —
        // put the user back where they were, then offer the only two things that
        // actually resolve it. A toast was a dead end: the switch leaves the broken
        // account inactive, so the account menu's Log out (which acts on the *active*
        // account) can never reach it, and retrying the switch just fails again.
        if (previousWasAnonymous) {
          this.auth.enterAnonymous();
        } else if (previousWasBluesky) {
          this.auth.enterBluesky();
        } else if (previous) {
          this.auth.switchTo(previous);
        } else {
          // Nothing to revert to: the failed token is still stored as active, so
          // clear it rather than leaving the app authenticated with a dead token.
          this.auth.exitToLoggedOut();
        }
        this.deadSession.set(session);
      },
    });
  }

  addMastodonAccount(): void {
    // ?add=1 tells the login page not to bounce an already-signed-in user back home.
    location.assign('login/mastodon?add=1');
  }

  addBlueskyAccount(): void {
    location.assign('login/bluesky?add=1');
  }

  /**
   * Ask before leaving, so the user can take their data with them.
   *
   * Leaving used to be immediate, and it left every follow, list and subscribed
   * hashtag in `localStorage` — which is the wrong default for someone reading on a
   * machine that is not theirs. The dialog owns the teardown; this only reacts to
   * what they chose.
   */
  logout(): void {
    this.showLeave.set(true);
  }

  /**
   * Finish leaving after the dialog has already erased whatever was chosen.
   *
   * A wipe is always followed by a full page load rather than a soft navigation:
   * services hold their state in signals loaded at construction, so `AnonymousFollows`
   * and friends would happily keep serving data whose storage no longer exists. The
   * app already relies on this for account switching.
   */
  finishLeave(choice: LeaveChoice): void {
    this.showLeave.set(false);
    if (choice === 'all-data') {
      // Every session is gone by definition; there is nothing to fall back to.
      // The front page rather than a login form: this browser is now indistinguishable
      // from a first-time visitor's, which is precisely who `/` is written for.
      // Resolved against <base href> so it works under /_ui/ and /canary/ alike.
      location.assign(document.baseURI);
      return;
    }
    // `leaveActive`, never `logout`: the dialog promised not to delete anything,
    // and `logout` forgets the active account. This used to call `logout`, which
    // deleted the account the user was leaving and then silently signed them in
    // as the next one in the stable — so the app looked like it had switched
    // rather than destroyed, and the loss was only noticed after it had happened
    // twice. Saved accounts survive both remaining choices; `anonymous-data`
    // erases the Anonymous session's own keys and nothing else.
    this.auth.leaveActive();
    // Also the front page: `leaveActive` kept every saved account, and `/` offers
    // both doors plus the anonymous path, where a bare login form offers one.
    location.assign(document.baseURI);
  }
}
