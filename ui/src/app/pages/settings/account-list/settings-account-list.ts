import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, of } from 'rxjs';
import { Api } from '../../../api';
import { BulkActionId, BulkActions } from '../../../bulk-actions';
import { BulkActionsDialog } from '../../../bulk-actions-dialog/bulk-actions-dialog';
import { BulkProgress } from '../../../bulk-progress/bulk-progress';
import { Account } from '../../../models';

type Kind = 'mutes' | 'blocks';

const PAGE_SIZE = 40;

/**
 * Muted accounts / Blocked accounts — one component, chosen by route data
 * `kind`.
 *
 * Carries the matching amnesty action at the top, because looking at a list of
 * 200 blocks you no longer care about is exactly when you want to be rid of all
 * of them, and hunting through Settings for the tab that does it is friction at
 * the wrong moment. It is the same job the Bulk actions tab starts, same dialog,
 * same progress panel.
 *
 * ## Paging
 *
 * The list used to render whatever the first unpaginated read returned — 40
 * accounts — while amnesty, which walks every page, reported 280. Same list, two
 * numbers, and no way to reach accounts 41 onward.
 *
 * Mastodon paginates these two lists by *relationship* id, a value that appears
 * nowhere in the account objects, so the cursor only ever arrives in the `Link`
 * header (see {@link Api.accountListPage}). That makes random access impossible:
 * page 5 is only reachable by fetching pages 1-4 first. So "last page" walks
 * forward, and every page it passes through lands in {@link cursors} and
 * {@link pageCache} — which is what keeps First/Prev/Next/Last from re-hitting
 * the server once a page has been seen.
 */
@Component({
  selector: 'app-settings-account-list',
  imports: [RouterLink, BulkActionsDialog, BulkProgress],
  templateUrl: './settings-account-list.html',
  styleUrl: './settings-account-list.css',
})
export class SettingsAccountList implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private bulk = inject(BulkActions);

  protected kind = signal<Kind>('mutes');
  protected accounts = signal<Account[]>([]);
  protected loading = signal(false);

  // ---------------------------------------------------------------- paging

  /** 0-based index of the page on screen. */
  protected page = signal(0);

  /**
   * `cursors[n]` is the `max_id` that fetches page `n`; `cursors[0]` is always
   * undefined (page 1 needs no cursor). Grows by one each time a page reveals a
   * `Link` header pointing further on.
   */
  private cursors: (string | undefined)[] = [undefined];

  /** Pages already fetched, by index — the microcache behind Prev/Last. */
  private pageCache = new Map<number, Account[]>();

  /**
   * The other-list flags for each cached page.
   *
   * Cached beside the page itself, so revisiting one costs nothing at all.
   * Without this, paging back re-asked `/relationships` every time and the
   * microcache only half worked — the expensive part of a Prev click is the
   * round trip, not which endpoint it goes to.
   */
  private otherCache = new Map<number, ReadonlySet<string>>();

  /** Follow state per cached page, kept beside {@link otherCache}. */
  private followingCache = new Map<number, ReadonlySet<string>>();

  /** True once a page comes back with no `rel="next"`: the walk has an end. */
  protected lastPageKnown = signal(false);

  /** Highest page index we know exists, or null while still unknown. */
  protected lastPage = signal<number | null>(null);

  protected readonly canPrev = computed(() => this.page() > 0 && !this.loading());
  protected readonly canNext = computed(
    () => !this.loading() && (this.lastPage() === null || this.page() < this.lastPage()!),
  );

  /**
   * Human range for the header, e.g. "41–80". Deliberately not "of 280": the
   * total is unknowable until the whole list has been walked, and claiming a
   * total we have not verified is the bug this page started with.
   */
  protected readonly rangeLabel = computed(() => {
    const start = this.page() * PAGE_SIZE + 1;
    const end = start + this.accounts().length - 1;
    return this.accounts().length ? `${start}–${end}` : '';
  });

  // ------------------------------------------------------- the other list

  /**
   * Ids that are *also* on the opposite list (blocked accounts that are muted
   * too, or vice versa).
   *
   * Converting a mute to a block is a decision you cannot make without knowing
   * whether the block already exists, and the row gave no clue either way.
   */
  protected alsoOther = signal<ReadonlySet<string>>(new Set());

  /**
   * Ids on this page that the viewer still follows.
   *
   * Muting does not unfollow, so "muted but still followed" is an ordinary
   * state rather than an edge case — and this page is where you notice it.
   * Blocking *does* force an unfollow server-side, which is why the Blocked
   * list never shows this and only the Muted one offers Unfollow.
   */
  protected following = signal<ReadonlySet<string>>(new Set());

  /** Rows whose convert/add button is mid-flight, so it can disable itself. */
  protected busy = signal<ReadonlySet<string>>(new Set());

  // -------------------------------------------------------------- amnesty

  protected readonly amnestyRunning = this.bulk.running;
  /** True while the confirmation dialog for this page's amnesty is open. */
  protected readonly asking = signal(false);

  protected readonly amnestyAction = computed<BulkActionId>(() =>
    this.kind() === 'mutes' ? 'mute-amnesty' : 'block-amnesty',
  );

  protected readonly amnestyLabel = computed(() =>
    this.kind() === 'mutes' ? 'Unmute everyone' : 'Unblock everyone',
  );

  constructor() {
    // Reload once the job finishes so the list reflects what just happened
    // rather than showing accounts that are no longer muted or blocked.
    effect(() => {
      const phase = this.bulk.job()?.phase;
      if (phase === 'done' || phase === 'cancelled' || phase === 'failed') {
        this.reset();
      }
    });
  }

  protected askAmnesty(): void {
    if (!this.amnestyRunning()) {
      this.asking.set(true);
    }
  }

  protected cancelAmnesty(): void {
    this.asking.set(false);
  }

  protected confirmAmnesty(): void {
    this.asking.set(false);
    void this.bulk.start(this.amnestyAction());
  }

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      this.kind.set((data['kind'] as Kind) ?? 'mutes');
      this.reset();
    });
  }

  protected get title(): string {
    return this.kind() === 'mutes' ? 'Muted accounts' : 'Blocked accounts';
  }

  protected get subtitle(): string {
    return this.kind() === 'mutes'
      ? "You won't see posts or notifications from these accounts. They can still follow you."
      : "These accounts can't follow you, see your posts, or interact with you.";
  }

  /** Label for the opposite list, used across the row buttons and badges. */
  protected get otherWord(): string {
    return this.kind() === 'mutes' ? 'block' : 'mute';
  }

  /** {@link otherWord} as a button label. */
  protected get otherVerb(): string {
    return this.kind() === 'mutes' ? 'Block' : 'Mute';
  }

  /** Past tense for the badge. Spelled out because "mute" + "ed" is "muteed". */
  protected get otherPastTense(): string {
    return this.kind() === 'mutes' ? 'blocked' : 'muted';
  }

  // ------------------------------------------------------------ fetching

  /** Throw away every cached page and cursor, then load page 1. */
  private reset(): void {
    this.cursors = [undefined];
    this.pageCache.clear();
    this.otherCache.clear();
    this.followingCache.clear();
    this.lastPageKnown.set(false);
    this.lastPage.set(null);
    this.page.set(0);
    this.loadPage(0);
  }

  /**
   * Show page `index`, fetching only the pages not already cached.
   *
   * Walks forward from the furthest known cursor when `index` is beyond it,
   * because a `Link`-paginated list offers no way to jump.
   */
  private loadPage(index: number): void {
    const cached = this.pageCache.get(index);
    if (cached) {
      this.page.set(index);
      this.accounts.set(cached);
      // Flags come from the cache too — a revisited page costs no requests at all.
      this.alsoOther.set(this.otherCache.get(index) ?? new Set());
      this.following.set(this.followingCache.get(index) ?? new Set());
      return;
    }

    if (index >= this.cursors.length) {
      // Need the intervening pages first to learn this page's cursor.
      this.walkTo(index);
      return;
    }

    this.loading.set(true);
    this.api.accountListPage(this.kind(), this.cursors[index], PAGE_SIZE).subscribe({
      next: ({ accounts, nextMaxId }) => {
        this.pageCache.set(index, accounts);
        this.page.set(index);
        this.accounts.set(accounts);
        this.recordCursor(index, accounts, nextMaxId);
        this.loading.set(false);
        this.markOtherList(index, accounts);
      },
      error: () => this.loading.set(false),
    });
  }

  /**
   * Fetch pages one at a time until `target` is reached or the list runs out.
   *
   * Used by "Last page" (target `Infinity`) and by any jump past the furthest
   * cursor we hold. Each hop is cached, so walking to the end once makes every
   * page in between free from then on.
   */
  private walkTo(target: number): void {
    const next = this.cursors.length - 1;
    const cursor = this.cursors[next];
    if (next > 0 && cursor === undefined) {
      // No further cursor: we are already at the end of the list.
      this.loadPage(next);
      return;
    }

    this.loading.set(true);
    this.api.accountListPage(this.kind(), cursor, PAGE_SIZE).subscribe({
      next: ({ accounts, nextMaxId }) => {
        this.pageCache.set(next, accounts);
        this.recordCursor(next, accounts, nextMaxId);

        const atEnd = !nextMaxId || !accounts.length;
        if (atEnd || next >= target) {
          const landing = atEnd ? Math.min(target, next) : target;
          this.loading.set(false);
          this.page.set(landing);
          this.accounts.set(this.pageCache.get(landing) ?? []);
          // Only the page we land on needs its flags — the ones walked past were
          // never displayed, so asking about them would be pure waste.
          this.markOtherList(landing, this.pageCache.get(landing) ?? []);
          return;
        }
        this.walkTo(target);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Remember where the page after `index` starts, and whether one exists. */
  private recordCursor(index: number, accounts: Account[], nextMaxId: string | null): void {
    if (nextMaxId && accounts.length) {
      if (this.cursors.length === index + 1) {
        this.cursors.push(nextMaxId);
      }
    } else {
      this.lastPageKnown.set(true);
      this.lastPage.set(index);
    }
  }

  protected first(): void {
    if (this.page() !== 0) {
      this.loadPage(0);
    }
  }

  protected prev(): void {
    if (this.canPrev()) {
      this.loadPage(this.page() - 1);
    }
  }

  protected next(): void {
    if (this.canNext()) {
      this.loadPage(this.page() + 1);
    }
  }

  protected last(): void {
    if (this.loading()) {
      return;
    }
    const known = this.lastPage();
    if (known !== null) {
      this.loadPage(known);
    } else {
      this.walkTo(Number.MAX_SAFE_INTEGER);
    }
  }

  /**
   * Ask the server which accounts on this page are on the other list too.
   *
   * One `/relationships` call per page rather than per row — it takes the whole
   * page's ids at once, so paging costs one extra request, not forty.
   */
  private markOtherList(index: number, accounts: Account[]): void {
    if (!accounts.length) {
      this.alsoOther.set(new Set());
      this.following.set(new Set());
      return;
    }
    this.api.relationships(accounts.map((a) => a.id)).subscribe({
      next: (rels) => {
        const muting = this.kind() === 'mutes';
        const flagged = new Set(
          rels.filter((r) => (muting ? r.blocking : r.muting)).map((r) => r.id),
        );
        // The same response already says whether you follow them — muting does
        // not unfollow, so this is a common state and worth reading off here
        // rather than spending a second call on it.
        const followed = new Set(rels.filter((r) => r.following).map((r) => r.id));
        this.otherCache.set(index, flagged);
        this.followingCache.set(index, followed);
        // Only paint if this is still the page on screen: a fast Next while the
        // lookup was in flight would otherwise flag the wrong rows.
        if (this.page() === index) {
          this.alsoOther.set(flagged);
          this.following.set(followed);
        }
      },
      error: () => {
        if (this.page() === index) {
          this.alsoOther.set(new Set());
          this.following.set(new Set());
        }
      },
    });
  }

  // ------------------------------------------------------------ row actions

  /** True when this account is on the opposite list as well as this one. */
  protected isAlsoOther(id: string): boolean {
    return this.alsoOther().has(id);
  }

  /**
   * Whether to offer Unfollow for this row.
   *
   * Muted lists only. A block already forces the unfollow server-side, so the
   * button could never do anything there — and there is deliberately no Follow
   * counterpart: nobody arrives at their mute list to start following someone,
   * and the profile is one click away for the rare case that they do.
   */
  protected canUnfollow(id: string): boolean {
    return this.kind() === 'mutes' && this.following().has(id);
  }

  /** Stop following without touching the mute — the two are independent. */
  protected unfollow(acc: Account): void {
    if (this.isBusy(acc.id)) {
      return;
    }
    this.setBusy(acc.id, true);
    this.api.unfollow(acc.id).subscribe({
      next: () => {
        this.clearFollow(acc.id);
        this.setBusy(acc.id, false);
      },
      error: () => this.setBusy(acc.id, false),
    });
  }

  /** Forget that this account is followed, on screen and in the page cache. */
  private clearFollow(id: string): void {
    const left = new Set(this.following());
    left.delete(id);
    this.following.set(left);
    this.followingCache.set(this.page(), left);
  }

  protected isBusy(id: string): boolean {
    return this.busy().has(id);
  }

  private setBusy(id: string, on: boolean): void {
    this.busy.update((set) => {
      const copy = new Set(set);
      if (on) {
        copy.add(id);
      } else {
        copy.delete(id);
      }
      return copy;
    });
  }

  /** Drop a row from the page on screen and from its cached copy. */
  private dropRow(id: string): void {
    this.accounts.update((list) => list.filter((a) => a.id !== id));
    const cached = this.pageCache.get(this.page());
    if (cached) {
      this.pageCache.set(
        this.page(),
        cached.filter((a) => a.id !== id),
      );
    }
  }

  undo(acc: Account): void {
    const call =
      this.kind() === 'mutes' ? this.api.unmuteAccount(acc.id) : this.api.unblockAccount(acc.id);
    call.subscribe(() => this.dropRow(acc.id));
  }

  /**
   * Add the other list's state and keep this one — "block them as well as
   * muting them". Someone reaching for this has decided one restriction is not
   * enough, so the row stays where it is and gains the badge.
   */
  protected alsoApply(acc: Account): void {
    if (this.isBusy(acc.id)) {
      return;
    }
    this.setBusy(acc.id, true);
    const call =
      this.kind() === 'mutes' ? this.api.block(acc.id) : this.api.muteAccount(acc.id);
    call.subscribe({
      next: () => {
        const flagged = new Set(this.alsoOther()).add(acc.id);
        this.alsoOther.set(flagged);
        this.otherCache.set(this.page(), flagged);
        // Blocking forces an unfollow server-side, so the Unfollow button on
        // this row has just become a no-op. Drop it rather than leave a control
        // that would fire a request the server has already made moot.
        if (this.kind() === 'mutes') {
          this.clearFollow(acc.id);
        }
        this.setBusy(acc.id, false);
      },
      error: () => this.setBusy(acc.id, false),
    });
  }

  /**
   * Swap one restriction for the other: apply the opposite, lift this one, and
   * let the row leave the list it no longer belongs to.
   *
   * Applied before the lift so a failure leaves the account restricted rather
   * than briefly unrestricted — the safe direction to fail in.
   */
  protected convert(acc: Account): void {
    if (this.isBusy(acc.id)) {
      return;
    }
    this.setBusy(acc.id, true);
    const muting = this.kind() === 'mutes';
    const apply: Observable<unknown> = this.isAlsoOther(acc.id)
      ? of(null)
      : muting
        ? this.api.block(acc.id)
        : this.api.muteAccount(acc.id);
    const lift = muting ? this.api.unmuteAccount(acc.id) : this.api.unblockAccount(acc.id);

    apply.subscribe({
      next: () => {
        lift.subscribe({
          next: () => {
            this.dropRow(acc.id);
            this.setBusy(acc.id, false);
          },
          error: () => this.setBusy(acc.id, false),
        });
      },
      error: () => this.setBusy(acc.id, false),
    });
  }
}
