import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, Subscription } from 'rxjs';
import { Api } from '../../api';
import { Account, SearchResults, Status, Tag } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { FindPeople } from '../find-people/find-people';
import { AnonymousCapabilities } from '../../providers/anonymous/anonymous-capabilities';
import { AnonymousAccount } from '../../providers/anonymous/anonymous-account';
import { AnonymousPublicApi } from '../../providers/anonymous/anonymous-public-api';
import { anonymousAccountRouteRef } from '../../providers/anonymous/anonymous-route-ref';
import {
  buildFacets,
  Facet,
  FacetKind,
  filterLoaded,
  groupResults,
  statusMatchesFacet,
} from './search-refine';
import {
  MawkingbirdSearch,
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
  imports: [FormsModule, RouterLink, StatusCard, FindPeople],
  templateUrl: './search.html',
  styleUrl: './search.css',
})
export class Search implements OnInit {
  protected capabilities = inject(AnonymousCapabilities);
  private api = inject(Api);
  private anonymous = inject(AnonymousAccount);
  private anonymousPublic = inject(AnonymousPublicApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  protected saved = inject(SavedSearches);
  private activeSearch: Subscription | null = null;

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
      account: target === 'accounts' ? { text: this.query().trim() } : undefined,
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
        this.fetch(q.trim(), t);
      } else {
        this.activeSearch?.unsubscribe();
        this.searching.set(false);
        this.results.set(null);
        this.loadTrends();
      }
    });
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

    if (search.target === 'posts') {
      // Run through the advanced path so the serializer/hashtag-transform apply.
      this.query.set(p.words ?? '');
      this.applyAdvanced();
    } else {
      this.query.set((search.account?.text ?? search.hashtag?.text ?? '').trim());
      this.run();
    }
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
    // A new search resets the budget counters and pagination cursors (§7/§20).
    this.callsUsed.set(0);
    this.tagsDropped.set(0);
    this.nextOffset = 0;
    this.oldestId = '';
    this.executedQuery = q;
    this.executedType = type;
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

    // Handle- or URL-shaped queries get resolve=true so the server webfingers
    // accounts it hasn't federated with yet (how you find someone by address).
    const resolve =
      type === 'accounts' && (/^@?[\w.-]+@[\w.-]+\.\w+$/.test(q) || /^https?:\/\//.test(q));
    const cost = this.firstPageTags ? this.firstPageTags.length : 1;
    const request = this.capabilities.active
      ? type === 'statuses'
        ? this.anonymousPublic.searchPostsByHashtags(this.anonymous.server(), q, {
            maxTags: this.apiBudget(),
          })
        : this.anonymousPublic.search(this.anonymous.server(), q, type)
      : this.api.search(
          q,
          type,
          type === 'statuses'
            ? { limit: PAGE_SIZE }
            : resolve
              ? { resolve: true }
              : undefined,
        );
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
