import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { PageDiagnostics } from '../../page-diagnostics';
import { BlueskySearch } from '../../providers/bluesky/bluesky-search';
import { BlueskySession } from '../../providers/bluesky/bluesky-session';
import {
  BlueskyPostSearch,
  describeBlueskyFilters,
  emptyBlueskyPostSearch,
  hasBlueskyFilters,
  parseTags,
} from '../../providers/bluesky/bluesky-post-search';
import { filterLoaded, buildFacets, statusMatchesFacet, FacetKind } from './search-refine';
import {
  serializeWebQuery,
  webSearchUrl,
  WEB_ENGINES,
  WebEngine,
} from './web-query-serializer';
import {
  sortAccounts,
  sortStatuses,
  ACCOUNT_SORTS,
  AccountSortKey,
  STATUS_SORTS,
  StatusSortKey,
} from './search-sort';
import { AccountResultCard } from './account-result-card';
import { AccountWithMatches } from './account-refine';
import { Account, Relationship } from '../../models';
import {
  BlueskyAccountResult,
  BlueskyAccountSearch,
} from '../../providers/bluesky/bluesky-account-search';
import { BlueskyGraph } from '../../providers/bluesky/bluesky-graph';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';
import { Auth } from '../../auth';
import { Terminology } from '../../terminology';

/** Which Bluesky index the panel is querying. */
export type BlueskySearchTarget = 'posts' | 'accounts';

/**
 * Bluesky post search: its own query form, its own results.
 *
 * A separate component rather than a branch inside `Search` — the two engines
 * take genuinely different filters (see `bluesky-post-search.ts`), and threading
 * a source flag through a 1,700-line component would put a check in front of
 * every widget. What *is* shared is everything that operates on results once
 * they exist: `StatusCard`, `filterLoaded`, `buildFacets`, `sortStatuses`. Those
 * are pure functions over `Status[]` and do not care where the posts came from.
 */
@Component({
  selector: 'app-bluesky-search-panel',
  imports: [FormsModule, RouterLink, StatusCard, AccountResultCard],
  templateUrl: './bluesky-search-panel.html',
  styleUrl: './bluesky-search-panel.css',
})
export class BlueskySearchPanel {
  /** post/tweet/florp vocabulary, per the Blue setting. */
  protected words = inject(Terminology).words;

  /**
   * A saved Bluesky search to load and run, handed down by the page.
   *
   * The page owns the saved-search *list* (it is shared with Mastodon and lives
   * in the shared bar); this panel owns the criteria form. So re-running one is
   * a hand-off: the page says which, the panel decides how.
   */
  readonly savedToRun = input<BlueskyPostSearch | null>(null);

  /** Fired when the panel wants the page to open its save dialog. */
  readonly saveRequested = output<BlueskyPostSearch>();

  constructor() {
    // Apply a handed-down saved search once it arrives. An `effect` rather than
    // a setter so the page can hand one over at any point in its lifecycle —
    // on first load from `?saved=`, or later from the Saved menu.
    effect(() => {
      const saved = this.savedToRun();
      if (!saved) {
        return;
      }
      this.criteria.set(structuredClone(saved));
      this.target.set('posts');
      this.run();
    });
  }

  /** The current criteria, for the page's save dialog. */
  requestSave(): void {
    this.saveRequested.emit(structuredClone(this.criteria()));
  }

  protected readonly webEngines = WEB_ENGINES;

  /**
   * Hand the query to a web engine, scoped to `bsky.app`.
   *
   * The escape hatch for the one thing anonymous visitors genuinely cannot do:
   * `app.bsky.feed.searchPosts` refuses unauthenticated callers at both hosts —
   * and refuses them with a Cloudflare-style HTML block page rather than an API
   * error, so there is nothing to degrade gracefully *into*.
   *
   * But Bluesky posts are public web pages, so `site:bsky.app` on a real engine
   * finds them without any account anywhere. Same hand-off the Mastodon panel
   * already offers, pointed at a different host.
   *
   * Only the free-text half is translated. Bluesky's structured filters (author,
   * tags, language, date bounds) have no `site:`-style equivalent, and the
   * serializer reports what it dropped — but this button is offered *instead of*
   * a search that cannot run at all, so the honest framing is "here is a way to
   * find something", not "here is your search, minus bits".
   */
  protected searchTheWeb(engine: WebEngine): void {
    const text = this.criteria().text.trim();
    if (!text) {
      return;
    }
    const { query } = serializeWebQuery({ words: text }, 'bsky.app');
    this.diagnostics.info('Search', 'bsky:web-handoff', { engine });
    window.open(webSearchUrl(engine, query), '_blank', 'noopener');
  }

  private search = inject(BlueskySearch);
  private accountSearch = inject(BlueskyAccountSearch);
  private graph = inject(BlueskyGraph);
  private diagnostics = inject(PageDiagnostics);
  protected session = inject(BlueskySession);
  private auth = inject(Auth);
  private anonymousFollows = inject(AnonymousFollows);

  /**
   * Posts or accounts.
   *
   * The two differ in more than which endpoint runs: account search works
   * signed out (measured — `public.api.bsky.app` answers it, the entryway does
   * not) while post search does not, and `searchActors` takes a bare query with
   * no filters at all. So the advanced panel and the unlinked notice are both
   * scoped to the posts target.
   */
  protected target = signal<BlueskySearchTarget>('posts');

  protected setTarget(target: BlueskySearchTarget): void {
    if (this.target() === target) {
      return;
    }
    this.target.set(target);
    this.clearResults();
  }

  /** Account results, hydrated with counts. */
  protected accounts = signal<BlueskyAccountResult[]>([]);
  protected accountSort = signal<AccountSortKey>('relevance');
  protected readonly accountSorts = ACCOUNT_SORTS;
  private accountCursor = signal<string | null>(null);
  /** DIDs with a follow/unfollow in flight. */
  protected followBusy = signal<Set<string>>(new Set());

  /** Account results after the loaded-text filter and sort. */
  protected visibleAccounts = computed(() => {
    const needle = this.loadedFilter().trim().toLowerCase();
    const matching = needle
      ? this.accounts().filter((r) =>
          `${r.account.display_name} ${r.account.acct} ${r.account.note}`
            .toLowerCase()
            .includes(needle),
        )
      : this.accounts();
    const sorted = sortAccounts(
      matching.map((r) => this.asItem(r)),
      this.accountSort(),
    );
    // Re-attach relationships by id after sorting, which only sees the account.
    const byId = new Map(this.accounts().map((r) => [r.account.id, r]));
    return sorted.map((item) => byId.get(item.account.id)!).filter(Boolean);
  });

  protected asItem(result: BlueskyAccountResult): AccountWithMatches {
    // `searchActors` matches on profile text, so there are never matching
    // posts to show — this is the bio-only shape the card already handles.
    return { account: result.account, matchingPosts: [] };
  }

  protected profileLink(account: Account): (string | number)[] {
    return ['/accounts', account.id];
  }

  protected isFollowBusy(account: Account): boolean {
    return this.followBusy().has(account.id);
  }

  /**
   * Follow or unfollow from a result card.
   *
   * Only reachable signed in: an anonymous search has no `viewer` block, so no
   * relationship is known and the card shows no follow button.
   */
  protected toggleFollow(account: Account, following: boolean): void {
    // Anonymous: the follow is browser-local and instant — there is no account
    // on Bluesky to write it to, and `AnonymousBlueskyProvider` reads this same
    // store to build the home feed. This is the "follow people client-side"
    // half of the anonymous experience.
    if (!this.session.linked() && this.auth.isAnonymousIdentity) {
      if (following) {
        this.anonymousFollows.unfollow(account, '');
      } else {
        const result = this.anonymousFollows.follow(account, '');
        if (!result.ok) {
          this.error.set(result.error);
        }
      }
      // Re-read: the cards render from `accounts()`, and nothing else changed.
      this.accounts.update((list) => [...list]);
      return;
    }
    const did = account.id.replace(/^bsky:/, '');
    this.followBusy.update((busy) => new Set(busy).add(account.id));
    const call = following ? this.graph.unfollow(did) : this.graph.follow(did);
    call.subscribe({
      next: (updated) => {
        this.accounts.update((list) =>
          list.map((r) =>
            r.account.id === account.id
              ? { ...r, relationship: { ...r.relationship, ...updated } }
              : r,
          ),
        );
        this.clearFollowBusy(account.id);
      },
      error: (error: unknown) => {
        this.clearFollowBusy(account.id);
        this.diagnostics.error('Search', 'bsky:follow-failed', error, { did });
        this.error.set(
          error instanceof Error ? error.message : 'Could not update the follow on Bluesky.',
        );
      },
    });
  }

  private clearFollowBusy(id: string): void {
    this.followBusy.update((busy) => {
      const next = new Set(busy);
      next.delete(id);
      return next;
    });
  }

  /**
   * Whether following is unavailable for this result set.
   *
   * **Not** simply "no linked account". An anonymous visitor follows *locally* —
   * the follow lives in `AnonymousFollows` and drives the anonymous Bluesky feed
   * provider — so for them the button works and follow state is known exactly.
   * The genuinely unusable case is a signed-out or Mastodon-primary reader with
   * no Bluesky link: no local store to write to and no session to write with.
   */
  protected followUnavailable = computed(
    () => !this.session.linked() && !this.auth.isAnonymousIdentity,
  );

  protected relationshipFor(result: BlueskyAccountResult): Relationship | null {
    // Anonymous: the server sends no `viewer`, but the browser-local store knows
    // the answer for certain, so read it from there rather than reporting
    // unknown.
    if (!this.session.linked() && this.auth.isAnonymousIdentity) {
      const following = this.anonymousFollows.isFollowing(result.account, '');
      return {
        id: result.account.id,
        following,
        followed_by: false,
        requested: false,
        blocking: false,
        muting: false,
      } as Relationship;
    }
    return result.relationship;
  }

  protected criteria = signal<BlueskyPostSearch>(emptyBlueskyPostSearch());
  /** Tag input is free text; parsed into the AND-matched list on search. */
  protected tagInput = signal('');
  protected advancedOpen = signal(false);

  protected statuses = signal<Status[]>([]);
  protected searching = signal(false);
  protected loadingMore = signal(false);
  protected error = signal<string | null>(null);
  protected ran = signal(false);
  protected hitsTotal = signal<number | null>(null);
  /** Signals, not fields: `exhausted` is a computed and must see them change. */
  private cursor = signal<string | null>(null);

  // Client-side refinement over what is already loaded. Identical in behaviour
  // to the Mastodon side because it is literally the same functions.
  protected loadedFilter = signal('');
  protected statusSort = signal<StatusSortKey>('relevance');
  protected selectedFacets = signal<{ kind: FacetKind; value: string }[]>([]);
  protected readonly statusSorts = STATUS_SORTS;

  protected exhausted = computed(() =>
    this.target() === 'accounts'
      ? this.ran() && !this.accountCursor()
      : this.ran() && !this.cursor(),
  );

  /** True when the last search produced nothing at all. */
  protected empty = computed(() =>
    this.target() === 'accounts' ? !this.accounts().length : !this.statuses().length,
  );

  protected facets = computed(() => buildFacets(this.statuses()));

  protected activeFilters = computed(() => describeBlueskyFilters(this.criteria()));
  protected hasFilters = computed(() => hasBlueskyFilters(this.criteria()));

  /** The loaded posts after the text filter, facet selections and sort. */
  protected visible = computed(() => {
    const selected = this.selectedFacets();
    const matching = this.statuses().filter((status) =>
      selected.every(({ kind, value }) => statusMatchesFacet(status, kind, value)),
    );
    return sortStatuses(filterLoaded(matching, this.loadedFilter()), this.statusSort());
  });

  /** Patch a field of the criteria object without replacing the rest. */
  protected set<K extends keyof BlueskyPostSearch>(key: K, value: BlueskyPostSearch[K]): void {
    this.criteria.update((current) => ({ ...current, [key]: value }));
  }

  protected setText(value: string): void {
    this.set('text', value);
  }

  protected toggleFacet(kind: FacetKind, value: string): void {
    this.selectedFacets.update((current) => {
      const hit = current.find((f) => f.kind === kind && f.value === value);
      return hit
        ? current.filter((f) => f !== hit)
        : [...current.filter((f) => f.kind !== kind), { kind, value }];
    });
  }

  protected isFacetSelected(kind: FacetKind, value: string): boolean {
    return this.selectedFacets().some((f) => f.kind === kind && f.value === value);
  }

  protected clearRefinements(): void {
    this.selectedFacets.set([]);
    this.loadedFilter.set('');
  }

  /** Drop results and paging state, keeping the query the reader typed. */
  private clearResults(): void {
    this.statuses.set([]);
    this.accounts.set([]);
    this.clearRefinements();
    this.cursor.set(null);
    this.accountCursor.set(null);
    this.ran.set(false);
    this.error.set(null);
    this.hitsTotal.set(null);
  }

  reset(): void {
    this.criteria.set(emptyBlueskyPostSearch());
    this.tagInput.set('');
    this.clearResults();
  }

  run(): void {
    const text = this.criteria().text.trim();
    if (!text || this.searching()) {
      return;
    }
    // Tags are only read at search time, so typing in the box does not silently
    // change what the "active filters" line claims about the last search.
    this.set('tags', parseTags(this.tagInput()));
    this.clearResults();
    this.searching.set(true);
    this.fetch();
  }

  loadMore(): void {
    const cursor = this.target() === 'accounts' ? this.accountCursor() : this.cursor();
    if (!cursor || this.loadingMore() || this.searching()) {
      return;
    }
    this.loadingMore.set(true);
    this.fetch();
  }

  private fetch(): void {
    if (this.target() === 'accounts') {
      this.fetchAccounts();
      return;
    }
    this.fetchPosts();
  }

  private fetchPosts(): void {
    this.search.search(this.criteria(), this.cursor()).subscribe({
      next: (page) => {
        this.cursor.set(page.cursor);
        // Dedupe: a shifting index can repeat a post across pages.
        const seen = new Set(this.statuses().map((s) => s.id));
        this.statuses.update((list) => [...list, ...page.statuses.filter((s) => !seen.has(s.id))]);
        this.hitsTotal.set(page.hitsTotal ?? null);
        this.settle();
        this.diagnostics.info('Search', 'load:bsky-posts', {
          results: page.statuses.length,
          more: !!page.cursor,
        });
      },
      error: (error: unknown) => this.fail(error, 'load:bsky-posts-error'),
    });
  }

  private fetchAccounts(): void {
    this.accountSearch.search(this.criteria().text.trim(), this.accountCursor()).subscribe({
      next: (page) => {
        this.accountCursor.set(page.cursor);
        const seen = new Set(this.accounts().map((r) => r.account.id));
        this.accounts.update((list) => [
          ...list,
          ...page.results.filter((r) => !seen.has(r.account.id)),
        ]);
        this.settle();
        this.diagnostics.info('Search', 'load:bsky-accounts', {
          results: page.results.length,
          more: !!page.cursor,
        });
      },
      error: (error: unknown) => this.fail(error, 'load:bsky-accounts-error'),
    });
  }

  private settle(): void {
    this.searching.set(false);
    this.loadingMore.set(false);
    this.ran.set(true);
  }

  private fail(error: unknown, event: string): void {
    this.settle();
    this.cursor.set(null);
    this.accountCursor.set(null);
    this.diagnostics.error('Search', event, error);
    this.error.set(error instanceof Error ? error.message : 'Bluesky search failed.');
  }
}
