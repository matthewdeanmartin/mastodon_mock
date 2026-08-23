import { computed, Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';

const READ_KEY_BASE = 'mockingbird_rss_read';
const STAR_KEY_BASE = 'mockingbird_rss_starred';

/**
 * When an item was read, keyed by the item's `Status.id`.
 *
 * A timestamp rather than a bare id set, even though nothing reads the value
 * yet: the 90-day wipe on the roadmap needs something to prune against, and
 * retrofitting a timestamp onto an id-only store later is a migration on data
 * that lives in other people's browsers. Storing a number now costs eight bytes
 * an item and removes that problem entirely.
 */
type ReadMap = Record<string, number>;

/** When an item was starred, same shape and same reasoning as {@link ReadMap}. */
type StarMap = Record<string, number>;

function load(key: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    // Drop anything that isn't a number — a hand-edited or half-written entry
    // should cost one item's state, not the whole store.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, at]) => typeof at === 'number' && Number.isFinite(at),
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Which RSS items have been read, and which are starred.
 *
 * Account-scoped `localStorage` like every other Mockingbird preference (see
 * {@link scopedKey}) — one person's reading history is not another's, and the
 * Anonymous account gets its own.
 *
 * ## Keyed by `Status.id`, not by (feed, guid)
 *
 * The adapter already builds `rss:<feedUrl>::<guid>` for every item
 * (`itemToStatus`), and that string is what the rendered card carries. Reusing
 * it verbatim is what guarantees read-state ids and rendered-item ids cannot
 * drift apart — the sprint's stated requirement — and it means marking a card
 * read never has to re-derive anything from the feed it came from.
 *
 * ## Read and starred are separate stores, deliberately
 *
 * They are independent booleans: a read item can be starred, an unread item can
 * be starred. Collapsing them into one per-item enum or record would make
 * "star an unread item" express something the data model has to special-case.
 * Two flat maps stay obvious, and each can be pruned on its own schedule (read
 * state ages out; a star is a deliberate act and should not).
 */
@Injectable({ providedIn: 'root' })
export class RssReadState {
  private readonly readKey = scopedKey(READ_KEY_BASE);
  private readonly starKey = scopedKey(STAR_KEY_BASE);

  private readonly readMap = signal<ReadMap>(load(this.readKey));
  private readonly starMap = signal<StarMap>(load(this.starKey));

  /** How many items are known-read. Exposed for diagnostics and settings copy. */
  readonly readCount = computed(() => Object.keys(this.readMap()).length);

  /** Every starred item id, newest star first. Backs the Starred filter. */
  readonly starredIds = computed(() =>
    Object.entries(this.starMap())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id),
  );

  readonly starredCount = computed(() => Object.keys(this.starMap()).length);

  isRead(itemId: string): boolean {
    return this.readMap()[itemId] !== undefined;
  }

  isStarred(itemId: string): boolean {
    return this.starMap()[itemId] !== undefined;
  }

  /** Mark one item read. A no-op when it already is, so callers can be careless. */
  markRead(itemId: string, at = Date.now()): void {
    if (this.isRead(itemId)) {
      return;
    }
    this.persistRead({ ...this.readMap(), [itemId]: at });
  }

  markUnread(itemId: string): void {
    if (!this.isRead(itemId)) {
      return;
    }
    const { [itemId]: _dropped, ...rest } = this.readMap();
    this.persistRead(rest);
  }

  /**
   * Mark many items read in one write.
   *
   * The bulk path exists because "mark all as read" on a folder can be hundreds
   * of items, and doing that as N calls to {@link markRead} would be N
   * serializations of the whole map to `localStorage`.
   *
   * **The caller decides the scope.** This takes an explicit list of ids rather
   * than a feed URL or folder name on purpose: the single most embarrassing bug
   * this feature could ship is marking everything read when the user asked for
   * one feed, and that is much easier to get wrong inside a store that resolves
   * scope for itself than in a caller that had to name the items.
   */
  markManyRead(itemIds: readonly string[], at = Date.now()): void {
    const next = { ...this.readMap() };
    let changed = false;
    for (const id of itemIds) {
      if (next[id] === undefined) {
        next[id] = at;
        changed = true;
      }
    }
    if (changed) {
      this.persistRead(next);
    }
  }

  /** Star or unstar one item. */
  setStarred(itemId: string, starred: boolean, at = Date.now()): void {
    if (starred === this.isStarred(itemId)) {
      return;
    }
    if (starred) {
      this.persistStar({ ...this.starMap(), [itemId]: at });
    } else {
      const { [itemId]: _dropped, ...rest } = this.starMap();
      this.persistStar(rest);
    }
  }

  toggleStarred(itemId: string): void {
    this.setStarred(itemId, !this.isStarred(itemId));
  }

  /** Forget everything. For the settings page's "clear reading history". */
  clear(): void {
    this.persistRead({});
    this.persistStar({});
  }

  private persistRead(map: ReadMap): void {
    this.readMap.set(map);
    localStorage.setItem(this.readKey, JSON.stringify(map));
  }

  private persistStar(map: StarMap): void {
    this.starMap.set(map);
    localStorage.setItem(this.starKey, JSON.stringify(map));
  }
}
