import { inject, Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { isCanaryBuild } from './build-flavor';

/**
 * Shape of the global GoatCounter object injected by //gc.zgo.at/count.js.
 * count() may not exist yet if a navigation lands before the async script has
 * loaded; callers must null-check it.
 */
interface GoatCounter {
  count?(vars: { path: string }): void;
  no_onload?: boolean;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

/**
 * Drives GoatCounter page-view counting off Angular's router.
 *
 * The stock GoatCounter SPA snippet listens for `hashchange`, which never fires
 * under Angular's path-based (PathLocationStrategy) router — so we count on
 * `NavigationEnd` instead. The script is loaded with `no_onload: true`
 * (index.html) so it does NOT auto-count the initial load; NavigationEnd fires
 * for that first navigation too, so every view — initial and subsequent — is
 * counted here exactly once, with the real path.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsTracker {
  private readonly router = inject(Router);

  start(): void {
    // Canary is a testing deployment (normally just me), so don't pollute the
    // stats with it — only production counts.
    if (isCanaryBuild()) {
      return;
    }
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.count(e.urlAfterRedirects));
  }

  private count(path: string): void {
    // count.js loads async; if a navigation beats it, that view is skipped
    // rather than queued — acceptable for lightweight page analytics.
    window.goatcounter?.count?.({ path });
  }
}
