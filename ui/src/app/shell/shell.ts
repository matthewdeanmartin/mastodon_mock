import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgOptimizedImage } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Api } from '../api';
import { AccountChoice, Auth, Session } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { ElizaService } from '../eliza/eliza.service';
import { LocalNotificationStore } from '../eliza/local-notification-store';
import { environment } from '../../environments/environment';
import { brandLogoSrc, isCanaryBuild } from '../build-flavor';
import { Hotkeys } from '../hotkeys';
import { ShortcutHelp } from '../shortcut-help/shortcut-help';
import { AppFooter } from './app-footer/app-footer';
import { LeftRail } from './left-rail/left-rail';
import { RightRail } from './right-rail/right-rail';
import { ServerAbout } from '../server-about';

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
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell implements OnInit {
  protected auth = inject(Auth);
  protected eliza = inject(ElizaService);
  protected elizaNotifs = inject(LocalNotificationStore);
  private api = inject(Api);
  private router = inject(Router);
  /** Mastodon-compatible keyboard shortcuts (and the "?" help dialog). */
  protected hotkeys = inject(Hotkeys);
  protected prefs = inject(ClientPrefs);
  protected serverAbout = inject(ServerAbout);

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
          // Token was rejected: drop it (falling back to another saved account if any).
          this.auth.logout();
          if (!this.auth.isAuthenticated) {
            location.assign('login');
          }
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
            key: `mastodon:${target.token}`,
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
        // revert to where we were and tell the user (non-blocking toast).
        const name = session.account?.display_name || session.account?.username || 'that account';
        if (previousWasAnonymous) {
          this.auth.enterAnonymous();
        } else if (previous) {
          this.auth.switchTo(previous);
        }
        this.showToast(
          `Couldn't switch to ${name} — its session may have expired. Sign in again to refresh it.`,
        );
      },
    });
  }

  addAccount(): void {
    // ?add=1 tells the login page not to bounce an already-signed-in user back home.
    location.assign('login?add=1');
  }

  /** Sign out of just the active account; fall back to another if one remains. */
  logout(): void {
    this.auth.logout();
    if (this.auth.isAuthenticated) {
      location.reload();
    } else {
      location.assign('login');
    }
  }
}
