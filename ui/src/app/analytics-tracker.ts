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
    window.goatcounter?.count?.({ path: sanitizePath(path) });
  }
}

/**
 * Strips personally-identifying data out of a route before it reaches
 * analytics. We only want to know which *kinds* of page get visited, never
 * which specific account, post, tag, list, etc. someone looked at — that's
 * both a privacy leak and pure noise in GoatCounter's Pages report.
 *
 * Two things get removed:
 *   1. The query string, entirely (e.g. ?open=pub:cynical13@… &with=1095…).
 *   2. Any dynamic ID-like segment that follows a known collection prefix,
 *      replaced with `:id` so `/accounts/111422…` collapses to `/accounts/:id`.
 *
 * Anything not matched is passed through unchanged, so static routes keep
 * their real, readable paths.
 */
export function sanitizePath(path: string): string {
  // Drop the query string and fragment; only the pathname carries the route.
  const pathname = path.split(/[?#]/, 1)[0];

  // Collection prefixes whose next segment is a per-item identifier we must
  // not record. tags/:tag is included: a tag name is a lookup someone made.
  const idParents = new Set(['accounts', 'statuses', 'lists', 'collections', 'filters', 'tags']);

  // Static child routes that share a collection prefix but are NOT identifiers
  // (e.g. /settings/filters/new, /collections/starter). Leave these readable.
  const staticChildren = new Set(['new', 'starter']);

  const segments = pathname.split('/');
  for (let i = 0; i < segments.length - 1; i++) {
    const child = segments[i + 1];
    if (idParents.has(segments[i]) && child !== '' && !staticChildren.has(child)) {
      segments[i + 1] = ':id';
    }
  }
  return segments.join('/');
}
