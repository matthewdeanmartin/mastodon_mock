import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgOptimizedImage } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Api } from '../api';
import { AccountChoice, Auth, Session } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { BotPeers } from '../chat/bot-peers';
import { environment } from '../../environments/environment';
import { brandLogoSrc, isCanaryBuild } from '../build-flavor';
import { Hotkeys } from '../hotkeys';
import { ShortcutHelp } from '../shortcut-help/shortcut-help';
import { AppFooter } from './app-footer/app-footer';
import { LeftRail } from './left-rail/left-rail';
import { RightRail } from './right-rail/right-rail';
import { ServerAbout } from '../server-about';
import { FeatureFlags } from '../feature-flags';
import { LeaveChoice, LeaveDialog } from '../leave-dialog/leave-dialog';

function isWideUrl(url: string): boolean {
  // /search goes rails-off wide so facets have room to live beside results.
  return (
    url.startsWith('/settings') || url.startsWith('/conversations') || url.startsWith('/search')
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
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell implements OnInit {
  protected auth = inject(Auth);
  private bots = inject(BotPeers);

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
  protected serverAbout = inject(ServerAbout);
  protected featureFlags = inject(FeatureFlags);

  /** Build flavor: drives the brand and whether mock-only nav links are shown. */
  protected mockTooling = environment.mockTooling;
  /** Canary deployments (/canary/ base href) show a distinct name, mark, accent. */
  protected isCanary = isCanaryBuild();
  protected brand = this.isCanary ? 'Canary' : environment.brand;
  protected logoSrc = brandLogoSrc();

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

  /** The leave/log-out confirmation, which also offers to erase browser data. */
  protected showLeave = signal(false);

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
    location.assign('login?add=1');
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
    this.hotkeys.start();
    if (this.auth.isAnonymous) {
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
    if (session.kind === 'anonymous') {
      this.auth.switchAccount(session);
      location.reload();
      return;
    }
    const previous = this.auth.token();
    const previousWasAnonymous = this.auth.isAnonymous;
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

  addAccount(): void {
    // ?add=1 tells the login page not to bounce an already-signed-in user back home.
    location.assign('login?add=1');
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
      location.assign('login');
      return;
    }
    this.auth.logout();
    if (choice === 'leave' && this.auth.isAuthenticated) {
      location.reload();
    } else {
      location.assign('login');
    }
  }
}
