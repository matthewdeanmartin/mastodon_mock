import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { parseBlueskyQuery, serializeBlueskyQuery } from './bluesky-query-serializer';
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

/**
 * Which Bluesky index the panel is querying.
 *
 * Spelled with the Mastodon side's vocabulary (`statuses`, not `posts`) because
 * it is now driven by the *same* type select — one signal on the page feeds both
 * networks, and translating at this boundary is cheaper than teaching the page
 * two words for one idea.
 */
export type BlueskySearchTarget = 'statuses' | 'accounts';

/**
 * Bluesky search: the criteria form and the results, inside the page's layout.
 *
 * A separate component rather than a branch inside `Search` — the two engines
 * take genuinely different filters (see `bluesky-post-search.ts`), and threading
 * a source flag through a 2,000-line component would put a check in front of
 * every widget. What *is* shared is everything that operates on results once
 * they exist: `StatusCard`, `filterLoaded`, `buildFacets`, `sortStatuses`. Those
 * are pure functions over `Status[]` and do not care where the posts came from.
 *
 * What is emphatically *not* separate any more is the chrome. The query box,
 * the network/type selects, Search, Advanced, Syntax, the AI helper, Save and
 * Share all live on the page and drive this panel through inputs. An earlier
 * version owned its own copies, which is how Bluesky search ended up looking
 * like a different application: a seg control where Mastodon had a select, a
 * filter strip across the top where Mastodon had a sticky left column, and
 * chip-buttons where Mastodon had checkboxes. The panel renders the page's
 * layout classes (`search-form-box`, `search-results-box`, `advanced-panel`,
 * `refine-bar`, `facet`) so the two networks are one interface.
 */
@Component({
  selector: 'app-bluesky-search-panel',
  imports: [FormsModule, StatusCard, AccountResultCard],
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

  /**
   * The shared query box's contents.
   *
   * The box lives on the page, so its text arrives as an input and is parsed
   * into criteria at search time (see `run`). Typed operators — `from:`,
   * `since:`, `#tag` — are read here exactly as bsky.app reads them.
   */
  readonly query = input('');

  /** Posts or accounts, from the page's shared type select. */
  readonly target = input<BlueskySearchTarget>('statuses');

  /** Whether the page's shared Advanced button is toggled on. */
  readonly advancedOpen = input(false);

  /** Fired when the panel wants the page to open its save dialog. */
  readonly saveRequested = output<BlueskyPostSearch>();

  /** Pushes criteria back into the shared query box, after Advanced edits it. */
  readonly queryChange = output<string>();

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
      // Reflect it into the shared box, so what ran and what is displayed agree.
      this.queryChange.emit(serializeBlueskyQuery(this.criteria()));
      this.runCurrent();
    });

    // Switching posts/accounts on the shared select drops results: they are
    // different result shapes from different endpoints, and leaving the old
    // ones on screen under a new heading is a lie about what was searched.
    effect(() => {
      this.target();
      untracked(() => this.clearResults());
    });
  }

  /**
   * Whether the two-box grid should apply.
   *
   * Same rule as the Mastodon side: one column until a search has actually
   * produced something to refine, because a lone form in a 360px column beside
   * an empty box looks broken.
   */
  readonly twoBox = computed(() => this.ran() && !this.empty());

  /** The current criteria, for the page's save dialog. */
  requestSave(): void {
    this.saveRequested.emit(structuredClone(this.criteria()));
  }

  /**
   * The active filters as prose, for the AI helper's context block.
   *
   * The same lines the chips show, so what the model is told matches what the
   * reader can see set on screen.
   */
  describeCriteria(): string[] {
    return describeBlueskyFilters(this.criteria());
  }

  private search = inject(BlueskySearch);
  private accountSearch = inject(BlueskyAccountSearch);
  private graph = inject(BlueskyGraph);
  private diagnostics = inject(PageDiagnostics);
  protected session = inject(BlueskySession);
  private auth = inject(Auth);
  private anonymousFollows = inject(AnonymousFollows);

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
  /** Facets start open, matching the Mastodon panel's `refineOpen`. */
  protected refineOpen = signal(true);
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
    this.queryChange.emit('');
    this.clearResults();
  }

  /**
   * Run what the shared query box currently says.
   *
   * Called by the page's Search button. The box is authoritative: its text is
   * parsed into criteria, so `from:pfrazee since:2026-01-01` typed by hand and
   * the same values entered in Advanced produce identical searches — and the AI
   * helper, which emits this syntax, lands in the form for free.
   */
  runQuery(): void {
    const typed = this.query().trim();
    if (!typed) {
      return;
    }
    const parsed = parseBlueskyQuery(typed);
    // Ranking is not part of the typed syntax, so it survives a re-parse.
    parsed.sort = this.criteria().sort;
    this.criteria.set(parsed);
    this.tagInput.set((parsed.tags ?? []).join(' '));
    this.runCurrent();
  }

  /**
   * Run the structured criteria as they stand.
   *
   * The Advanced form's "Apply & search" path, and the one saved searches take.
   * Reflects back into the box first so the reader can see — and edit, and copy
   * — what their form choices actually mean in Bluesky's syntax.
   */
  applyAdvanced(): void {
    // Tags are only read at apply time, so typing in the box does not silently
    // change what the "active filters" line claims about the last search.
    this.set('tags', parseTags(this.tagInput()));
    this.queryChange.emit(serializeBlueskyQuery(this.criteria()));
    this.runCurrent();
  }

  private runCurrent(): void {
    if (!this.criteria().text.trim() && !hasBlueskyFilters(this.criteria())) {
      return;
    }
    if (this.searching()) {
      return;
    }
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
