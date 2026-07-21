import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, Observable, of, Subscription } from 'rxjs';
import { Api } from '../../api';
import { Account, Relationship, SearchResults, Status, Tag } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { FindPeople } from '../find-people/find-people';
import { AnonymousCapabilities } from '../../providers/anonymous/anonymous-capabilities';
import { AnonymousAccount } from '../../providers/anonymous/anonymous-account';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';
import { AnonymousPublicApi } from '../../providers/anonymous/anonymous-public-api';
import { anonymousAccountRouteRef } from '../../providers/anonymous/anonymous-route-ref';
import { AccountResultCard } from './account-result-card';
import { AccountSearchStore } from './account-search-store';
import {
  AccountFacet,
  AccountFacetKind,
  AccountWithMatches,
  accountMatchesFacet,
  accountMatchesNumeric,
  buildAccountFacets,
  condenseStatusesToAuthors,
  filterAccounts,
  mergeAuthors,
} from './account-refine';
import {
  buildFacets,
  Facet,
  FacetKind,
  filterLoaded,
  groupResults,
  statusMatchesFacet,
} from './search-refine';
import {
  AccountSearchCriteria,
  AccountSearchSource,
  MawkingbirdSearch,
  NumericRange,
  PostContentType,
  PostSearchCriteria,
  ResultGrouping,
  SearchTarget,
  Tristate,
} from './mawkingbird-search';
import { serializeMastodonQuery } from './mastodon-query-serializer';
import { Chip, ExplainPanel, explainPostSearch, postChips } from './search-explain';
import { SavedSearches } from './saved-searches';
import { decodeSearchFromParams, encodeSearchToParams } from './search-url';

type SearchType = 'accounts' | 'statuses' | 'hashtags';

/** One selected facet value, keyed by "kind:value" (see selectedFacets). */
type FacetSelection = { kind: FacetKind; value: string };

/** Mastodon's max results per page. Big pages = a fatter faceting corpus per call. */
const PAGE_SIZE = 40;
/** Default budgets: a plain search pulls 2 pages; opening advanced bumps it to 3. */
const DEFAULT_BUDGET_SIMPLE = 2;
const DEFAULT_BUDGET_ADVANCED = 3;
/** Manual "Load more" can page past the budget, but stops here so it never runs away. */
const LOAD_MORE_HARD_CAP = 30;

@Component({
  selector: 'app-search',
  imports: [FormsModule, RouterLink, StatusCard, FindPeople, AccountResultCard],
  templateUrl: './search.html',
  styleUrl: './search.css',
})
export class Search implements OnInit, OnDestroy {
  protected capabilities = inject(AnonymousCapabilities);
  private api = inject(Api);
  private accountStore = inject(AccountSearchStore);
  private anonymous = inject(AnonymousAccount);
  private anonymousFollows = inject(AnonymousFollows);
  private anonymousPublic = inject(AnonymousPublicApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  protected saved = inject(SavedSearches);
  private activeSearch: Subscription | null = null;

  /** Dev-only structured logging. Silent in production builds. */
  private debug(...args: unknown[]): void {
    if (isDevMode()) {
      // eslint-disable-next-line no-console
      console.debug(...args);
    }
  }

  protected query = signal('');
  protected results = signal<SearchResults | null>(null);
  protected searching = signal(false);
  protected type = signal<SearchType>('accounts');

  // --- API-call budget (sprint 3) ---
  // A ceiling on HTTP requests one search may spend. `callsUsed` counts real
  // requests; pagination stops before it would exceed `apiBudget`. Anonymous
  // post search costs N calls per page (one tag timeline each), so the "next
  // page cost" is the tag count there and 1 everywhere else.
  // Budget = how many large (40-post) pages to pull eagerly on Search, so
  // client-side faceting has a real corpus to work with. Raising it after a
  // search tops up with the extra pages; "Load more" keeps going past it.
  protected readonly budgetOptions: { value: number; label: string }[] = [
    { value: 1, label: '1 page (~40 posts)' },
    { value: 2, label: '2 pages (~80 posts)' },
    { value: 3, label: '3 pages (~120 posts)' },
    { value: 5, label: '5 pages (~200 posts)' },
    { value: 10, label: '10 pages (~400 posts)' },
  ];
  protected apiBudget = signal<number>(DEFAULT_BUDGET_SIMPLE);
  protected callsUsed = signal(0);
  /** How many statuses were requested but capped away by the budget (anon fan-out). */
  protected tagsDropped = signal(0);

  // Pagination cursors for "load more": authenticated search pages by offset;
  // anonymous merges per-tag timelines paged by the oldest seen status id.
  private nextOffset = 0;
  private oldestId = '';
  private executedQuery = '';
  private executedType: SearchType = 'accounts';
  /** Hashtags used for the current anonymous post search (null when not applicable). */
  private firstPageTags: string[] | null = null;

  /** Requests the *next* page would spend: N tags anonymous, else 1. */
  protected nextPageCost = computed(() =>
    this.capabilities.active && this.executedType === 'statuses'
      ? (this.firstPageTags?.length ?? 1)
      : 1,
  );

  /** Auto-fill wants another page while the last one had results and the next
   *  page still fits inside the chosen budget (the eager corpus-building phase).
   *  Only post searches page — accounts/hashtags are a single call. */
  protected autoFillWants = computed(
    () =>
      this.executedType === 'statuses' &&
      !!this.results()?.statuses.length &&
      this.callsUsed() + this.nextPageCost() <= this.apiBudget(),
  );

  /** The manual "Load more" button keeps working past the budget (the user asked
   *  to keep loading), up to a hard safety cap so it can't run away. */
  protected canLoadMore = computed(
    () =>
      this.executedType === 'statuses' &&
      !!this.results()?.statuses.length &&
      this.callsUsed() < LOAD_MORE_HARD_CAP,
  );

  // --- Advanced post-search form (sprint 2) ---
  // Each field binds to ngModel; `postCriteria` assembles them into the rich
  // PostSearchCriteria that drives serialization, chips, and Explain.
  protected advancedOpen = signal(false);
  protected exactPhrase = signal('');
  protected excludeWords = signal('');
  protected author = signal('');
  protected before = signal('');
  protected after = signal('');
  protected language = signal('');
  protected contentType = signal<PostContentType>('any');
  protected replies = signal<Tristate>('include');
  protected sensitive = signal<Tristate>('include');
  protected scope = signal<'all' | 'public' | 'library'>('all');

  // --- Advanced account-search form (Phase 3) ---
  // `accountSource` picks where the query is matched: bio (the plain account
  // endpoint), posts (a post search condensed to its authors), or both merged.
  // The six numeric fields gate loaded results by follower/following/post counts
  // (the "real people vs celebrities vs dead accounts" tool) — client-side only.
  protected accountSource = signal<AccountSearchSource>('both');
  protected followersMin = signal('');
  protected followersMax = signal('');
  protected followingMin = signal('');
  protected followingMax = signal('');
  protected statusesMin = signal('');
  protected statusesMax = signal('');

  protected readonly accountSources: { value: AccountSearchSource; label: string }[] = [
    { value: 'both', label: 'Bio and posts' },
    { value: 'bio', label: 'Name & bio only' },
    { value: 'posts', label: 'What they post' },
  ];

  /** Parse a numeric-field string into a bound, ignoring blanks/garbage. */
  private numOrUndef(raw: string): number | undefined {
    const n = Number(raw.trim());
    return raw.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  private range(minRaw: string, maxRaw: string): NumericRange | undefined {
    const min = this.numOrUndef(minRaw);
    const max = this.numOrUndef(maxRaw);
    return min != null || max != null ? { min, max } : undefined;
  }

  /** The account advanced form assembled into rich criteria. */
  protected accountCriteria = computed<AccountSearchCriteria>(() => ({
    text: this.query().trim(),
    source: this.accountSource(),
    followers: this.range(this.followersMin(), this.followersMax()),
    following: this.range(this.followingMin(), this.followingMax()),
    statuses: this.range(this.statusesMin(), this.statusesMax()),
  }));

  /** True when any account advanced field is set beyond the defaults. */
  protected hasAccountAdvanced = computed(
    () =>
      this.accountSource() !== 'both' ||
      !!this.followersMin() ||
      !!this.followersMax() ||
      !!this.followingMin() ||
      !!this.followingMax() ||
      !!this.statusesMin() ||
      !!this.statusesMax(),
  );

  /** Bundled language options (no API call — spec §6.4). */
  protected readonly languages = [
    { code: '', label: 'Any language' },
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ja', label: 'Japanese' },
    { code: 'zh', label: 'Chinese' },
  ];

  protected readonly contentTypes: { value: PostContentType; label: string }[] = [
    { value: 'any', label: 'Any' },
    { value: 'media', label: 'Has media' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
    { value: 'audio', label: 'Audio' },
    { value: 'poll', label: 'Poll' },
    { value: 'link', label: 'Link or preview' },
    { value: 'text', label: 'Text only' },
  ];

  /** The advanced form assembled into the rich criteria object. */
  protected postCriteria = computed<PostSearchCriteria>(() => ({
    words: this.query().trim() || undefined,
    exactPhrase: this.exactPhrase().trim() || undefined,
    excludeWords: this.excludeWords().trim() || undefined,
    author: this.author().trim() || undefined,
    dates:
      this.after() || this.before()
        ? { after: this.after() || undefined, before: this.before() || undefined }
        : undefined,
    language: this.language() || undefined,
    contentType: this.contentType() === 'any' ? undefined : this.contentType(),
    replies: this.replies() === 'include' ? undefined : this.replies(),
    sensitive: this.sensitive() === 'include' ? undefined : this.sensitive(),
    scope: this.scope() === 'all' ? undefined : this.scope(),
  }));

  /** The complete current search assembled from all form state — the shape that
   *  gets saved and encoded into shareable URLs (§15/§16). Presentation/budget
   *  travel with it; transient view state (page, facets) deliberately does not. */
  protected currentSearch = computed<MawkingbirdSearch>(() => {
    const target = this.type() === 'statuses' ? 'posts' : (this.type() as SearchTarget);
    return {
      version: 1,
      target,
      account: target === 'accounts' ? this.accountCriteria() : undefined,
      hashtag: target === 'hashtags' ? { text: this.query().trim() } : undefined,
      post: target === 'posts' ? this.postCriteria() : undefined,
      apiCallBudget: this.apiBudget(),
      presentation: { grouping: this.grouping() },
    };
  });

  // --- Saved searches + sharing (sprint 4) ---
  protected savedMenuOpen = signal(false);
  protected saveDialogOpen = signal(false);
  protected saveName = signal('');
  protected shareCopied = signal(false);
  protected savedNotice = signal('');

  /** Active-filter chips for the last executed post search (§10). */
  protected chips = computed<Chip[]>(() =>
    this.type() === 'statuses' && this.results()
      ? postChips(this.executedCriteria() ?? {}, !this.capabilities.active)
      : [],
  );

  protected explainOpen = signal(false);

  /** Explain-panel content for the last executed post search (§9). */
  protected explain = computed<ExplainPanel | null>(() => {
    if (this.type() !== 'statuses' || !this.results()) {
      return null;
    }
    const anonTags = this.capabilities.active
      ? (this.results()?.hashtags ?? []).map((h) => h.name)
      : null;
    return explainPostSearch(
      {
        version: 1,
        target: 'posts',
        post: this.executedCriteria() ?? {},
        apiCallBudget: this.apiBudget(),
        presentation: { grouping: 'none' },
      },
      !this.capabilities.active,
      anonTags,
      { maximum: this.apiBudget(), used: this.callsUsed(), tagsDropped: this.tagsDropped() },
    );
  });

  /** Snapshot of the criteria that produced the current results (for chips/Explain). */
  private executedCriteria = signal<PostSearchCriteria | null>(null);

  /**
   * Criteria staged by the advanced form for the next fetch. Because
   * `applyAdvanced` rewrites the query box into the serialized string, we can't
   * reconstruct the structured criteria from the URL — so we stash them here and
   * let `fetch` adopt them, falling back to a words-only search for the plain box.
   */
  private pendingCriteria: PostSearchCriteria | null = null;

  // --- Client-side refinement over loaded post results (sprint 1) ---
  // None of this makes an API call: it narrows/reshapes results already in hand.
  protected loadedFilter = signal('');
  protected grouping = signal<ResultGrouping>('none');
  // Facets open by default — collapsed, the "Refine loaded results" section is
  // easy to miss entirely.
  protected refineOpen = signal(true);
  protected selectedFacets = signal<FacetSelection[]>([]);

  /** Statuses from the current results, after facet + text filtering. */
  protected visibleStatuses = computed<Status[]>(() => {
    const all = this.results()?.statuses ?? [];
    const facets = this.selectedFacets();
    // Facets of different kinds AND together; values within a kind OR together.
    const byKind = new Map<FacetKind, string[]>();
    for (const f of facets) {
      byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f.value]);
    }
    const faceted = all.filter((s) =>
      [...byKind.entries()].every(([kind, values]) =>
        values.some((v) => statusMatchesFacet(s, kind, v)),
      ),
    );
    return filterLoaded(faceted, this.loadedFilter());
  });

  /** Facets computed from all loaded statuses (counts reflect the full load). */
  protected facets = computed<Facet[]>(() => buildFacets(this.results()?.statuses ?? []));

  /** Loaded statuses reshaped by the current grouping selection. */
  protected groups = computed(() => groupResults(this.visibleStatuses(), this.grouping()));

  protected loadedCount = computed(() => this.results()?.statuses.length ?? 0);
  protected shownCount = computed(() => this.visibleStatuses().length);

  // Idle-state trends: shown under the box before anything is searched.
  protected trendingPosts = signal<Status[]>([]);
  protected trendingTags = signal<Tag[]>([]);
  private trendsRequested = false;
  /** Last q/type reflected in the URL, so run() can detect an identical re-search
   *  (which wouldn't emit a new queryParamMap) and fetch directly. */
  private urlQuery = '';
  private urlType: SearchType = 'accounts';

  private sharedLinkHandled = false;

  ngOnInit(): void {
    // Restore the query/type from the URL so that returning here (e.g. via the
    // browser back button after visiting a result) re-runs the same search
    // instead of showing an empty page.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      // On first load, a shared link may carry the full structured search
      // (a compact `?s=` blob or advanced flat params). Decode it once into the
      // form and run it, rather than treating it as a bare q/type search.
      if (!this.sharedLinkHandled && this.isSharedLink(params)) {
        this.sharedLinkHandled = true;
        const decoded = decodeSearchFromParams((k) => params.get(k));
        this.applySearch(decoded);
        return;
      }
      this.sharedLinkHandled = true;

      const q = params.get('q') ?? '';
      const t = (params.get('type') as SearchType) ?? 'accounts';
      this.urlQuery = q;
      this.urlType = t;
      this.query.set(q);
      this.type.set(t);
      if (q.trim()) {
        // Returning to an account search (e.g. Back from a profile): restore the
        // in-memory snapshot rather than re-running the whole fan-out.
        if (t === 'accounts' && this.restoreAccountSnapshot(q.trim())) {
          return;
        }
        this.fetch(q.trim(), t);
      } else {
        this.activeSearch?.unsubscribe();
        this.searching.set(false);
        this.results.set(null);
        this.loadTrends();
      }
    });
  }

  /** Save the current account result set so returning here restores it. */
  ngOnDestroy(): void {
    this.saveAccountSnapshot();
  }

  private saveAccountSnapshot(): void {
    if (this.type() !== 'accounts' || !this.accountItems().length) {
      return;
    }
    this.accountStore.save({
      query: this.executedQuery,
      items: this.accountItems(),
      relationships: this.relationships(),
      expanded: [...this.expandedAccounts()],
      facets: this.selectedAccountFacets(),
      filter: this.accountFilter(),
      bounds: this.executedAccountBounds(),
      callsUsed: this.callsUsed(),
      // The results column doesn't scroll internally (overflow:hidden) — the page
      // scrolls, so the window offset is what to restore.
      scrollTop: typeof window !== 'undefined' ? window.scrollY : 0,
    });
  }

  /** Restore a snapshot for `q` if one is stored; returns true when it did. */
  private restoreAccountSnapshot(q: string): boolean {
    const snap = this.accountStore.take(q);
    if (!snap) {
      return false;
    }
    this.debug('[search] restoring account snapshot', { q, items: snap.items.length });
    this.activeSearch?.unsubscribe();
    this.searching.set(false);
    this.results.set(null);
    this.executedQuery = snap.query;
    this.executedType = 'accounts';
    this.accountItems.set(snap.items);
    this.relationships.set(snap.relationships);
    this.expandedAccounts.set(new Set(snap.expanded));
    this.selectedAccountFacets.set(snap.facets);
    this.accountFilter.set(snap.filter);
    this.executedAccountBounds.set(snap.bounds);
    this.callsUsed.set(snap.callsUsed);
    this.accountSearchRan.set(true);
    // NOTE: scroll-offset restore is intentionally not attempted here. The
    // router's in-memory scroller resets scroll to top on navigation *after* this
    // runs, and racing it with timeouts proved unreliable. The result set itself
    // is fully restored (the thing that was expensive to rebuild); `snap.scrollTop`
    // is retained for a future fix that hooks the router's scroll event.
    return true;
  }

  /** A shared link is one carrying structured search beyond a bare q/type: the
   *  compact blob, or any of the advanced flat params. */
  private isSharedLink(params: { has(key: string): boolean }): boolean {
    return (
      params.has('s') ||
      params.has('after') ||
      params.has('media') ||
      params.has('language') ||
      params.has('scope') ||
      params.has('calls')
    );
  }

  /** Fetch trending posts + tags once, for the idle states. Failures show nothing. */
  private loadTrends(): void {
    if (this.trendsRequested) {
      return;
    }
    this.trendsRequested = true;
    this.api
      .trendingStatuses()
      .pipe(catchError(() => EMPTY))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((posts) => this.trendingPosts.set(posts));
    this.api
      .trendingTags()
      .pipe(catchError(() => EMPTY))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tags) => this.trendingTags.set(tags));
  }

  /** Sum of a tag's recent-history `uses` for the "N recent uses" line. */
  tagUses(tag: Tag): number {
    return (tag.history ?? []).reduce((sum, h) => sum + Number(h.uses || 0), 0);
  }

  run(): void {
    const q = this.query().trim();
    if (!q) {
      return;
    }
    const type = this.type();
    // Navigating to identical query params emits nothing, so re-clicking Search
    // (or changing the budget, which isn't in the URL) would be a silent no-op.
    // Detect that case (tracked from the queryParamMap subscription) and fetch
    // directly instead of relying on navigation.
    if (this.urlQuery === q && this.urlType === type) {
      this.fetch(q, type);
      return;
    }
    // Otherwise push the search into the URL; ngOnInit's subscription fetches.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q, type },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Execute the advanced post search. The rich `postCriteria` is the source of
   * truth: authenticated searches serialize it into a Mastodon full-text query;
   * anonymous searches can only send the plain words (the hashtag transform in
   * `searchPostsByHashtags` handles the rest), so the advanced criteria degrade
   * to loaded-result filters — which the chips/Explain panel make explicit.
   */
  applyAdvanced(): void {
    this.type.set('statuses');
    const criteria = this.postCriteria();
    this.pendingCriteria = criteria;
    // Authenticated: the serialized query IS the search string (operators and all).
    // Anonymous: only the words survive as a server request; the rest are shown
    // as loaded-result criteria and applied client-side after results arrive.
    const q = this.capabilities.active
      ? (criteria.words ?? '').trim() // anonymous: only words go to the hashtag transform
      : serializeMastodonQuery(criteria); // authenticated: full operator query
    if (!q.trim()) {
      return;
    }
    // Fetch directly rather than through the q= URL param: an advanced search's
    // real query string is a serialized DSL, and routing it through the URL would
    // stamp that DSL back into the query box (clobbering the plain words that
    // save/share need to capture). The structured criteria live in
    // `pendingCriteria`; the box keeps the user's plain words.
    this.fetch(q, 'statuses');
  }

  /** Toggle the advanced panel. Opening it raises the default budget to 3 (an
   *  advanced search is usually a faceting session that wants a bigger corpus),
   *  unless the user already picked a larger budget. */
  toggleAdvanced(): void {
    const opening = !this.advancedOpen();
    this.advancedOpen.set(opening);
    if (opening && this.apiBudget() < DEFAULT_BUDGET_ADVANCED) {
      this.apiBudget.set(DEFAULT_BUDGET_ADVANCED);
    }
  }

  clearAdvanced(): void {
    this.exactPhrase.set('');
    this.excludeWords.set('');
    this.author.set('');
    this.before.set('');
    this.after.set('');
    this.language.set('');
    this.contentType.set('any');
    this.replies.set('include');
    this.sensitive.set('include');
    this.scope.set('all');
    // The main box may hold a serialized DSL string from a prior Apply — clear it
    // too, otherwise the query lingers confusingly after the fields are emptied.
    this.query.set('');
  }

  // --- Saved searches + sharing ---

  /** Load a saved/shared search into the form and run it. Populates every field
   *  from the structured object (no DSL parsing — the object is canonical). */
  applySearch(search: MawkingbirdSearch): void {
    this.type.set(search.target === 'posts' ? 'statuses' : search.target);
    this.apiBudget.set(search.apiCallBudget || DEFAULT_BUDGET_SIMPLE);
    this.grouping.set(search.presentation?.grouping ?? 'none');

    const p = search.post ?? {};
    this.exactPhrase.set(p.exactPhrase ?? '');
    this.excludeWords.set(p.excludeWords ?? '');
    this.author.set(p.author ?? '');
    this.after.set(p.dates?.after ?? '');
    this.before.set(p.dates?.before ?? '');
    this.language.set(p.language ?? '');
    this.contentType.set(p.contentType ?? 'any');
    this.replies.set(p.replies ?? 'include');
    this.sensitive.set(p.sensitive ?? 'include');
    this.scope.set(p.scope ?? 'all');

    // Restore account advanced fields (source + numeric bounds).
    const acc = search.account;
    this.accountSource.set(acc?.source ?? 'both');
    this.followersMin.set(acc?.followers?.min != null ? String(acc.followers.min) : '');
    this.followersMax.set(acc?.followers?.max != null ? String(acc.followers.max) : '');
    this.followingMin.set(acc?.following?.min != null ? String(acc.following.min) : '');
    this.followingMax.set(acc?.following?.max != null ? String(acc.following.max) : '');
    this.statusesMin.set(acc?.statuses?.min != null ? String(acc.statuses.min) : '');
    this.statusesMax.set(acc?.statuses?.max != null ? String(acc.statuses.max) : '');

    if (search.target === 'posts') {
      // Run through the advanced path so the serializer/hashtag-transform apply.
      this.query.set(p.words ?? '');
      this.applyAdvanced();
    } else {
      this.query.set((acc?.text ?? search.hashtag?.text ?? '').trim());
      this.run();
    }
  }

  /** Run an account search from the advanced panel. The account form fields are
   *  live signals that `fetchAccounts` reads directly, so this just ensures the
   *  Accounts tab is active and (re-)runs. */
  applyAccountAdvanced(): void {
    this.type.set('accounts');
    if (!this.query().trim()) {
      return;
    }
    this.run();
  }

  clearAccountAdvanced(): void {
    this.accountSource.set('both');
    this.followersMin.set('');
    this.followersMax.set('');
    this.followingMin.set('');
    this.followingMax.set('');
    this.statusesMin.set('');
    this.statusesMax.set('');
  }

  runSaved(id: string): void {
    const found = this.saved.all().find((s) => s.id === id);
    if (found) {
      this.savedMenuOpen.set(false);
      this.applySearch(found.search);
    }
  }

  openSaveDialog(): void {
    this.saveName.set('');
    this.saveDialogOpen.set(true);
  }

  confirmSave(): void {
    const result = this.saved.save(this.saveName(), this.currentSearch(), {
      instance: this.capabilities.active ? this.anonymous.server() : '',
      authenticated: !this.capabilities.active,
    });
    this.saveDialogOpen.set(false);
    this.savedNotice.set(result.ok ? 'Search saved.' : result.error);
    setTimeout(() => this.savedNotice.set(''), 3000);
  }

  /** Copy a shareable link to the current search definition. */
  async share(): Promise<void> {
    const params = new URLSearchParams(encodeSearchToParams(this.currentSearch())).toString();
    // Resolve against <base href> so the link is valid under a sub-path like /_ui/.
    const url = new URL(`search?${params}`, document.baseURI).toString();
    try {
      await navigator.clipboard.writeText(url);
      this.shareCopied.set(true);
      setTimeout(() => this.shareCopied.set(false), 2000);
    } catch {
      // Clipboard blocked — surface the URL so the user can copy it manually.
      this.savedNotice.set(url);
    }
  }

  /** True when any advanced field is set (drives the "Clear" button visibility). */
  protected hasAdvanced = computed(
    () =>
      !!this.exactPhrase() ||
      !!this.excludeWords() ||
      !!this.author() ||
      !!this.before() ||
      !!this.after() ||
      !!this.language() ||
      this.contentType() !== 'any' ||
      this.replies() !== 'include' ||
      this.sensitive() !== 'include' ||
      this.scope() !== 'all',
  );

  // --- Refinement controls (all client-side, no API calls) ---

  isFacetSelected(kind: FacetKind, value: string): boolean {
    return this.selectedFacets().some((f) => f.kind === kind && f.value === value);
  }

  toggleFacet(kind: FacetKind, value: string): void {
    this.selectedFacets.update((sel) =>
      sel.some((f) => f.kind === kind && f.value === value)
        ? sel.filter((f) => !(f.kind === kind && f.value === value))
        : [...sel, { kind, value }],
    );
  }

  clearRefinements(): void {
    this.selectedFacets.set([]);
    this.loadedFilter.set('');
  }

  /** Change the budget. If a search already ran and the budget went up, top up
   *  by fetching the extra pages right away (§ user's "5 after 3 → fetch 2 more"). */
  setBudget(value: string | number): void {
    const next = Number(value);
    this.apiBudget.set(next);
    if (this.results()?.statuses.length && this.executedType === 'statuses') {
      this.maybeAutoFill(true);
    }
  }

  /** Drop everything derived from the previous result set before a new search. */
  private resetRefinements(): void {
    this.selectedFacets.set([]);
    this.loadedFilter.set('');
    this.grouping.set('none');
  }

  private fetch(q: string, type: SearchType): void {
    this.activeSearch?.unsubscribe();
    this.resetRefinements();
    // Account cards carry per-result state (relationships, expansion) that must
    // not leak across searches.
    this.relationships.set({});
    this.expandedAccounts.set(new Set());
    this.selectedAccountFacets.set([]);
    this.accountFilter.set('');
    this.accountItems.set([]);
    this.accountSearchRan.set(false);
    // A new search resets the budget counters and pagination cursors (§7/§20).
    this.callsUsed.set(0);
    this.tagsDropped.set(0);
    this.nextOffset = 0;
    this.oldestId = '';
    this.executedQuery = q;
    this.executedType = type;

    // Accounts have their own orchestration (bio / posts→authors / both).
    if (type === 'accounts') {
      this.fetchAccounts(q);
      return;
    }
    // Snapshot the criteria that produced this search so chips/Explain describe
    // exactly what was run. Advanced searches stage full criteria in
    // `pendingCriteria`; a plain-box status search is just the words.
    if (type === 'statuses') {
      this.executedCriteria.set(this.pendingCriteria ?? { words: q });
    } else {
      this.executedCriteria.set(null);
    }
    this.pendingCriteria = null;
    this.searching.set(true);

    // Anonymous post search fans out to one call per hashtag. Cap the tag count
    // to the budget so page 1 never exceeds it (§7 "never silently exceed"), and
    // record how many we dropped so Explain can note the truncation.
    if (this.capabilities.active && type === 'statuses') {
      const allTags = this.anonymousPublic.hashtagsForQuery(q);
      const affordable = allTags.slice(0, this.apiBudget());
      this.tagsDropped.set(allTags.length - affordable.length);
      this.firstPageTags = affordable;
    } else {
      this.firstPageTags = null;
    }

    // Only statuses/hashtags reach here (accounts early-return above).
    const cost = this.firstPageTags ? this.firstPageTags.length : 1;
    const request = this.capabilities.active
      ? type === 'statuses'
        ? this.anonymousPublic.searchPostsByHashtags(this.anonymous.server(), q, {
            maxTags: this.apiBudget(),
          })
        : this.anonymousPublic.search(this.anonymous.server(), q, type)
      : this.api.search(q, type, type === 'statuses' ? { limit: PAGE_SIZE } : undefined);
    this.activeSearch = request.subscribe({
      next: (r) => {
        this.results.set(r);
        this.callsUsed.update((c) => c + cost);
        this.rememberCursors(r);
        this.searching.set(false);
        // Eagerly page up to the budget so client-side faceting has a corpus.
        this.maybeAutoFill(r.statuses.length > 0);
      },
      error: () => this.searching.set(false),
    });
  }

  /**
   * Account orchestration (Phase 3). Depending on the chosen source:
   *  - `bio`   → the plain account endpoint (handle/name/bio match), paginated;
   *  - `posts` → a post search condensed to its distinct authors;
   *  - `both`  → both, merged and deduped by account id.
   * The rich numeric bounds are snapshotted so the client-side gates/facets
   * describe exactly what was requested. Relationships batch-load once results
   * are in. Post fan-out reuses the same hashtag transform as post search, so it
   * respects the API-call budget the same way.
   */
  private fetchAccounts(q: string): void {
    const criteria = this.accountCriteria();
    const source = criteria.source ?? 'both';
    this.executedAccountBounds.set(criteria);
    this.executedCriteria.set(null);
    this.pendingCriteria = null;
    this.accountSearchRan.set(false);
    this.searching.set(true);
    // A fresh fetch supersedes any stored snapshot for back-nav restore.
    this.accountStore.clear();

    // A branch that fails must not sink the whole search: real mastodon.social
    // authenticated *status* full-text search can 401/422 depending on server
    // config, and forkJoin would otherwise blank the account hits too. Each
    // branch degrades to an empty page (logged) so the other still shows.
    const EMPTY_RESULTS: SearchResults = { accounts: [], statuses: [], hashtags: [] };
    const resilient = (
      obs: Observable<SearchResults>,
      label: string,
    ): Observable<SearchResults> =>
      obs.pipe(
        catchError((err) => {
          // eslint-disable-next-line no-console
          console.warn(`[search] account "${label}" branch failed — degrading to empty`, err);
          return of(EMPTY_RESULTS);
        }),
      );

    // Handle- or URL-shaped queries get resolve=true so the server webfingers
    // accounts it hasn't federated with yet (how you find someone by address).
    const resolve = /^@?[\w.-]+@[\w.-]+\.\w+$/.test(q) || /^https?:\/\//.test(q);
    const bioReq: Observable<SearchResults> | null =
      source === 'posts'
        ? null
        : resilient(
            this.capabilities.active
              ? this.anonymousPublic.search(this.anonymous.server(), q, 'accounts', {
                  limit: PAGE_SIZE,
                })
              : this.api.search(
                  q,
                  'accounts',
                  resolve ? { resolve: true, limit: PAGE_SIZE } : { limit: PAGE_SIZE },
                ),
            'bio',
          );

    // Posts→authors: fan out to the same hashtag/post search the post tab uses.
    if (this.capabilities.active && source !== 'bio') {
      const allTags = this.anonymousPublic.hashtagsForQuery(q);
      const affordable = allTags.slice(0, this.apiBudget());
      this.tagsDropped.set(allTags.length - affordable.length);
      this.firstPageTags = affordable;
    } else {
      this.firstPageTags = null;
    }
    const postsReq: Observable<SearchResults> | null =
      source === 'bio'
        ? null
        : resilient(
            this.capabilities.active
              ? this.anonymousPublic.searchPostsByHashtags(this.anonymous.server(), q, {
                  maxTags: this.apiBudget(),
                })
              : this.api.search(q, 'statuses', { limit: PAGE_SIZE }),
            'posts',
          );

    // Each request costs at least 1; anonymous post fan-out costs one per tag.
    const postCost = this.firstPageTags ? this.firstPageTags.length : 1;

    this.debug('[search] account fetch', {
      q,
      source,
      anonymous: this.capabilities.active,
      bioReq: !!bioReq,
      postsReq: !!postsReq,
      tags: this.firstPageTags,
    });

    // Merge each branch's results into the list AS THEY ARRIVE, rather than
    // waiting for both (forkJoin) — real mastodon.social full-text status search
    // takes several seconds, and holding the instant bio results hostage behind
    // it made the search look broken. Each branch merges independently; the
    // spinner clears once both have settled.
    let pending = (bioReq ? 1 : 0) + (postsReq ? 1 : 0);
    const settle = (): void => {
      if (--pending <= 0) {
        this.searching.set(false);
        this.accountSearchRan.set(true);
      }
    };
    const mergeIn = (authors: AccountWithMatches[], addedCost: number): void => {
      if (authors.length) {
        this.accountItems.update((cur) => mergeAuthors(cur, authors));
        this.loadRelationships(authors.map((a) => a.account));
      }
      this.callsUsed.update((c) => c + addedCost);
    };

    const subs = new Subscription();
    if (bioReq) {
      subs.add(
        bioReq.subscribe((page) => {
          const authors = (page.accounts ?? []).map((account) => ({ account, matchingPosts: [] }));
          this.debug('[search] account bio results', { accounts: authors.length });
          mergeIn(authors, 1);
          settle();
        }),
      );
    }
    if (postsReq) {
      subs.add(
        postsReq.subscribe((page) => {
          const authors = condenseStatusesToAuthors(page.statuses ?? []);
          this.debug('[search] account post-author results', {
            statuses: page.statuses?.length ?? 0,
            authors: authors.length,
          });
          mergeIn(authors, postCost);
          settle();
        }),
      );
    }
    this.activeSearch = subs;
  }

  /**
   * §14 budget-fill: when enabled, keep paging until the budget is spent, the
   * server stops returning new results, or the user cancels. Guarded on the last
   * page having grown so we never loop on an endpoint that keeps returning the
   * same (already de-duped) statuses.
   */
  private maybeAutoFill(pageGrew: boolean): void {
    if (pageGrew && this.autoFillWants()) {
      this.loadMore();
    }
  }

  /** Update pagination cursors from the latest page of statuses. */
  private rememberCursors(r: SearchResults): void {
    this.nextOffset += r.statuses.length;
    // For anonymous, remember each tag's oldest status id so the next page of
    // that timeline starts below it.
    for (const s of r.statuses) {
      // Statuses don't carry their source tag, so track a single global floor:
      // the oldest id we've seen. getTagTimeline(max_id) is per-tag but using the
      // global oldest is a safe monotonic cursor for "older than everything shown".
      if (!this.oldestId || s.id < this.oldestId) {
        this.oldestId = s.id;
      }
    }
  }

  /**
   * Fetch one more page and append it. Used both by the eager budget auto-fill
   * and the manual "Load more" button. `manual` clicks keep working past the
   * budget (the user asked to keep loading) up to a hard safety cap.
   */
  loadMore(manual = false): void {
    if (this.searching()) {
      return;
    }
    if (manual) {
      if (this.callsUsed() >= LOAD_MORE_HARD_CAP) {
        return;
      }
    } else if (!this.autoFillWants()) {
      return;
    }
    this.searching.set(true);
    const cost = this.nextPageCost();
    const q = this.executedQuery;
    const request =
      this.capabilities.active && this.executedType === 'statuses'
        ? this.anonymousPublic.searchPostsByHashtags(this.anonymous.server(), q, {
            maxTags: this.firstPageTags?.length ?? this.apiBudget(),
            maxIds: Object.fromEntries(
              (this.firstPageTags ?? []).map((t) => [t, this.oldestId]).filter(([, v]) => v),
            ) as Record<string, string>,
          })
        : this.api.search(q, this.executedType, {
            offset: this.nextOffset,
            limit: PAGE_SIZE,
          });
    this.activeSearch = request.subscribe({
      next: (r) => {
        const added = this.appendResults(r);
        this.callsUsed.update((c) => c + cost);
        this.rememberCursors(r);
        this.searching.set(false);
        this.maybeAutoFill(added > 0);
      },
      error: () => this.searching.set(false),
    });
  }

  /** Merge a newly-fetched page into the current results, de-duping statuses.
   *  Returns how many new statuses were actually added. */
  private appendResults(page: SearchResults): number {
    let added = 0;
    this.results.update((cur) => {
      if (!cur) {
        added = page.statuses.length;
        return page;
      }
      const seen = new Set(cur.statuses.map((s) => s.url || s.id));
      const fresh = page.statuses.filter((s) => !seen.has(s.url || s.id));
      added = fresh.length;
      return { ...cur, statuses: [...cur.statuses, ...fresh] };
    });
    return added;
  }

  // --- Account results (Phase 2) ---
  // The account tab renders info-dense cards. Relationships for the whole loaded
  // set are batch-fetched once (the endpoint takes many ids at a time), and
  // follow/unfollow is owned here so the card stays presentational.
  /** Relationship per account id, populated by `loadRelationships`. */
  protected relationships = signal<Record<string, Relationship>>({});
  /** Account ids with a follow/unfollow request in flight. */
  protected followBusy = signal<Set<string>>(new Set());
  /** Account ids whose card has its "more" section expanded. */
  protected expandedAccounts = signal<Set<string>>(new Set());

  /** The raw loaded account result set (bio hits + condensed post authors,
   *  merged), before any client-side numeric/facet/text refinement. Set by the
   *  account fetch path; the visible list derives from it. */
  protected accountItems = signal<AccountWithMatches[]>([]);
  /** True once an account search has completed (success or error), so the empty
   *  state reads "no people found" instead of reverting to the idle import panel. */
  protected accountSearchRan = signal(false);

  // --- Account-result refinement (Phase 3, all client-side) ---
  /** Selected account facet values, keyed by kind + value. */
  protected selectedAccountFacets = signal<{ kind: AccountFacetKind; value: string }[]>([]);
  /** The "filter these people" substring over loaded account cards. */
  protected accountFilter = signal('');
  /** Snapshot of the numeric bounds that the current results are gated by. */
  private executedAccountBounds = signal<AccountSearchCriteria>({ text: '' });

  /** Facets computed from all loaded accounts (counts reflect the full load). */
  protected accountFacets = computed<AccountFacet[]>(() =>
    buildAccountFacets(this.accountItems().map((i) => i.account)),
  );

  /** The loaded accounts after numeric gates, facet selection, and text filter. */
  protected visibleAccounts = computed<AccountWithMatches[]>(() => {
    const bounds = this.executedAccountBounds();
    const facets = this.selectedAccountFacets();
    const byKind = new Map<AccountFacetKind, string[]>();
    for (const f of facets) {
      byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f.value]);
    }
    const gated = this.accountItems().filter(
      (item) =>
        accountMatchesNumeric(item.account, {
          followers: bounds.followers,
          following: bounds.following,
          statuses: bounds.statuses,
        }) &&
        [...byKind.entries()].every(([kind, values]) =>
          values.some((v) => accountMatchesFacet(item.account, kind, v)),
        ),
    );
    // Text filter reuses filterAccounts over the accounts, keeping matches attached.
    const kept = new Set(filterAccounts(gated.map((i) => i.account), this.accountFilter()));
    return gated.filter((i) => kept.has(i.account));
  });

  protected loadedAccountCount = computed(() => this.accountItems().length);
  protected shownAccountCount = computed(() => this.visibleAccounts().length);

  isAccountFacetSelected(kind: AccountFacetKind, value: string): boolean {
    return this.selectedAccountFacets().some((f) => f.kind === kind && f.value === value);
  }

  toggleAccountFacet(kind: AccountFacetKind, value: string): void {
    this.selectedAccountFacets.update((sel) =>
      sel.some((f) => f.kind === kind && f.value === value)
        ? sel.filter((f) => !(f.kind === kind && f.value === value))
        : [...sel, { kind, value }],
    );
  }

  clearAccountRefinements(): void {
    this.selectedAccountFacets.set([]);
    this.accountFilter.set('');
  }

  relationshipFor(id: string): Relationship | null {
    return this.relationships()[id] ?? null;
  }

  isFollowBusy(id: string): boolean {
    return this.followBusy().has(id);
  }

  isAccountExpanded(id: string): boolean {
    return this.expandedAccounts().has(id);
  }

  toggleAccountExpand(id: string): void {
    this.expandedAccounts.update((set) => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  /** Batch-fetch relationships for every loaded account. Anonymous viewers read
   *  the local follow store; authenticated viewers hit the relationships API
   *  (which accepts many ids per call, so ~100 accounts is one request). */
  private loadRelationships(accounts: Account[]): void {
    if (!accounts.length) {
      return;
    }
    if (this.capabilities.active) {
      const server = this.anonymous.server();
      const map: Record<string, Relationship> = {};
      for (const a of accounts) {
        map[a.id] = this.anonymousFollows.relationship(a, server);
      }
      this.relationships.update((cur) => ({ ...cur, ...map }));
      return;
    }
    this.api
      .relationships(accounts.map((a) => a.id))
      .pipe(catchError(() => EMPTY))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((rels) => {
        this.relationships.update((cur) => {
          const next = { ...cur };
          for (const r of rels) {
            next[r.id] = r;
          }
          return next;
        });
      });
  }

  private setFollowBusy(id: string, busy: boolean): void {
    this.followBusy.update((set) => {
      const next = new Set(set);
      busy ? next.add(id) : next.delete(id);
      return next;
    });
  }

  onFollow(account: Account): void {
    if (this.capabilities.active) {
      const result = this.anonymousFollows.follow(account, this.anonymous.server());
      if (result.ok) {
        this.relationships.update((cur) => ({ ...cur, [account.id]: result.relationship }));
      }
      return;
    }
    this.setFollowBusy(account.id, true);
    this.api
      .follow(account.id)
      .pipe(catchError(() => EMPTY))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rel) => this.relationships.update((cur) => ({ ...cur, [account.id]: rel })),
        complete: () => this.setFollowBusy(account.id, false),
      });
  }

  onUnfollow(account: Account): void {
    if (this.capabilities.active) {
      const rel = this.anonymousFollows.unfollow(account, this.anonymous.server());
      this.relationships.update((cur) => ({ ...cur, [account.id]: rel }));
      return;
    }
    this.setFollowBusy(account.id, true);
    this.api
      .unfollow(account.id)
      .pipe(catchError(() => EMPTY))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rel) => this.relationships.update((cur) => ({ ...cur, [account.id]: rel })),
        complete: () => this.setFollowBusy(account.id, false),
      });
  }

  accountLink(account: Account): (string | number)[] {
    return this.capabilities.active
      ? [
          '/accounts',
          anonymousAccountRouteRef({
            server: this.anonymous.server(),
            id: account.id,
            originalUrl: account.url || undefined,
          }),
        ]
      : ['/accounts', account.id];
  }

  onChanged(updated: Status): void {
    this.results.update((r) =>
      r ? { ...r, statuses: r.statuses.map((s) => (s.id === updated.id ? updated : s)) } : r,
    );
  }

  onTrendChanged(updated: Status): void {
    this.trendingPosts.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
  }

  onTrendDeleted(removed: Status): void {
    this.trendingPosts.update((list) => list.filter((s) => s.id !== removed.id));
  }

  onDeleted(removed: Status): void {
    this.results.update((r) =>
      r ? { ...r, statuses: r.statuses.filter((s) => s.id !== removed.id) } : r,
    );
  }
}
