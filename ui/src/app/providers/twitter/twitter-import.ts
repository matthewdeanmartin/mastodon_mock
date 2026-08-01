import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TwitterApi } from './twitter-api';
import { TwitterFollows } from './twitter-follows';
import { WireFollowing } from './twitterapi-io/wire-types';

/**
 * Import someone's Twitter following list, skipping the dead accounts.
 *
 * ## The two costs, which are nothing alike
 *
 * Measured 2026-08-01:
 *
 * - **Fetching the list is free and fast.** `user/followings` returns 200
 *   accounts per request and moved the credit balance by less than its
 *   resolution. Even 5,000 follows is ~25 requests.
 * - **Checking whether an account is still alive costs one request each**, and
 *   there is no bulk alternative: no endpoint on this service reports a
 *   last-tweet timestamp. `created_at` on both the profile and the followings
 *   entry is when the *account* was created, which says nothing about activity.
 *
 * The free tier allows **one request every five seconds**, which the service
 * states outright when you exceed it. So liveness for 200 candidates is about
 * 17 minutes of wall clock. That single fact shapes everything here: the check
 * cannot be a modal spinner, it has to be interruptible, and partial results
 * have to be worth keeping.
 *
 * ## So the import is staged
 *
 * 1. **Fetch the list.** Cheap, fast, and reversible — nothing is followed yet.
 * 2. **Filter on what the list already tells us.** `statuses_count === 0` means
 *    the account has never posted; `protected` means we could never read it.
 *    Both are free to detect and remove real accounts from the candidate set
 *    before any per-account request is spent.
 * 3. **Optionally check liveness**, one account at a time, oldest-first, with
 *    live progress and a Stop button. Every verdict is applied as it arrives,
 *    so stopping halfway leaves a shorter but correct import rather than
 *    nothing.
 *
 * Step 3 is opt-in precisely because it is the expensive one. Without it the
 * import still works — it just includes accounts that stopped posting in 2019,
 * which is the thing the user said they most wanted gone.
 */

/** Default cutoff for "dead": no post in this many days. */
export const DEFAULT_INACTIVE_DAYS = 365;

/** One account under consideration, with whatever we know so far. */
export interface ImportCandidate {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  /** Lifetime posts. Zero means never posted — free to detect. */
  statusesCount: number;
  protected: boolean;
  /** ISO date of the newest post, once checked. */
  lastPostedAt?: string | null;
  /** Why this candidate was excluded, or null if it is still in. */
  excluded: string | null;
  /** True once a liveness request has been spent on it. */
  checked: boolean;
}

export type ImportPhase = 'idle' | 'listing' | 'checking' | 'done' | 'stopped' | 'failed';

/** How long to wait between liveness requests, from the service's own limit. */
export const QPS_DELAY_MS = 5_200;

@Injectable({ providedIn: 'root' })
export class TwitterImport {
  private api = inject(TwitterApi);
  private follows = inject(TwitterFollows);

  readonly phase = signal<ImportPhase>('idle');
  readonly candidates = signal<ImportCandidate[]>([]);
  readonly error = signal<string | null>(null);
  /** Requests spent by this import, so the panel can show the running cost. */
  readonly requests = signal(0);
  /** How many liveness checks have completed, for the progress line. */
  readonly checked = signal(0);

  /** Set while a run should abort at the next opportunity. */
  private stopRequested = false;

  readonly keeping = computed(() => this.candidates().filter((c) => !c.excluded));
  readonly excluded = computed(() => this.candidates().filter((c) => c.excluded));

  /** Candidates still needing a request to decide. */
  readonly unchecked = computed(() =>
    this.candidates().filter((c) => !c.excluded && !c.checked),
  );

  /** Wall-clock estimate for checking the rest, in seconds. */
  readonly checkSeconds = computed(() =>
    Math.round((this.unchecked().length * QPS_DELAY_MS) / 1000),
  );

  readonly running = computed(
    () => this.phase() === 'listing' || this.phase() === 'checking',
  );

  stop(): void {
    this.stopRequested = true;
  }

  reset(): void {
    this.stopRequested = false;
    this.phase.set('idle');
    this.candidates.set([]);
    this.error.set(null);
    this.requests.set(0);
    this.checked.set(0);
  }

  /**
   * Fetch the accounts `username` follows, up to `stopAfter`.
   *
   * Nothing is followed by this — it only builds the candidate list, so the
   * user can look at it, adjust the filters, and decide. An import that
   * silently added 200 accounts to someone's feed would be very hard to undo.
   */
  async list(username: string, stopAfter: number): Promise<void> {
    this.reset();
    this.phase.set('listing');
    const collected: ImportCandidate[] = [];
    let cursor: string | undefined;

    try {
      while (collected.length < stopAfter) {
        const page = await firstValueFrom(this.api.getFollowings({ username }, cursor));
        this.requests.update((n) => n + 1);
        for (const user of page.users) {
          if (collected.length >= stopAfter) {
            break;
          }
          const candidate = toCandidate(user);
          if (candidate) {
            collected.push(candidate);
          }
        }
        this.candidates.set([...collected]);
        if (this.stopRequested) {
          this.phase.set('stopped');
          return;
        }
        if (!page.hasMore || !page.cursor) {
          break;
        }
        cursor = page.cursor;
        // Paging is a request too, so it is paced like everything else.
        await delay(QPS_DELAY_MS);
      }
      this.applyFreeFilters();
      this.phase.set('done');
    } catch (error: unknown) {
      this.error.set(
        error instanceof Error ? error.message : 'Could not read that following list.',
      );
      this.phase.set('failed');
    }
  }

  /**
   * Exclusions that cost nothing, applied as soon as the list arrives.
   *
   * Worth doing separately from the liveness check: these remove real accounts
   * from the candidate set *before* any per-account request is spent on them,
   * so the expensive step has less to do.
   */
  private applyFreeFilters(): void {
    this.candidates.update((all) =>
      all.map((candidate) => {
        if (candidate.protected) {
          // We could never read their posts, so following them here would add a
          // permanently empty feed.
          return { ...candidate, excluded: 'Protected account — their posts cannot be read.' };
        }
        if (candidate.statusesCount === 0) {
          return { ...candidate, excluded: 'Has never posted.' };
        }
        return candidate;
      }),
    );
  }

  /**
   * Check each remaining candidate's last post, excluding the long-dormant.
   *
   * One request per account with a five-second gap, so this is minutes rather
   * than seconds — see the class comment. Verdicts are applied as they arrive
   * and {@link stop} takes effect between accounts, so stopping early leaves a
   * usable partial result.
   */
  async checkLiveness(inactiveDays = DEFAULT_INACTIVE_DAYS): Promise<void> {
    this.stopRequested = false;
    this.phase.set('checking');
    const cutoff = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;

    for (const candidate of this.unchecked()) {
      if (this.stopRequested) {
        this.phase.set('stopped');
        return;
      }
      try {
        const lastPostedAt = await firstValueFrom(this.api.getLastPostedAt(candidate.userId));
        this.requests.update((n) => n + 1);
        const dead = !lastPostedAt || Date.parse(lastPostedAt) < cutoff;
        this.patch(candidate.userId, {
          lastPostedAt,
          checked: true,
          excluded: dead
            ? lastPostedAt
              ? `No posts since ${lastPostedAt.slice(0, 10)}.`
              : 'No readable posts.'
            : null,
        });
      } catch {
        // An account we cannot check is kept rather than dropped: excluding
        // someone because of a transient failure is the worse mistake, and the
        // user can still untick them by hand.
        this.patch(candidate.userId, { checked: true });
      }
      this.checked.update((n) => n + 1);
      await delay(QPS_DELAY_MS);
    }
    this.phase.set('done');
  }

  /** Put a candidate back in, or take one out, by hand. */
  toggle(userId: string): void {
    this.candidates.update((all) =>
      all.map((candidate) =>
        candidate.userId === userId
          ? { ...candidate, excluded: candidate.excluded ? null : 'Skipped by you.' }
          : candidate,
      ),
    );
  }

  /**
   * Follow everyone still included, and report how many landed.
   *
   * Respects {@link TWITTER_FOLLOW_LIMIT} rather than silently overflowing it,
   * and returns the shortfall so the UI can say what was left out instead of
   * pretending the import was complete.
   */
  apply(): { added: number; skipped: number; capped: number; already: number } {
    const keeping = this.keeping();
    let added = 0;
    let already = 0;
    let capped = 0;
    for (const candidate of keeping) {
      // `add` reports duplicates and the cap by returning a message. Counting
      // its refusals as successes would tell someone 200 accounts were imported
      // when most were already followed.
      const refusal = this.follows.add({
        username: candidate.username,
        displayName: candidate.displayName,
        avatar: candidate.avatar,
        userId: candidate.userId,
      });
      if (!refusal) {
        added++;
      } else if (/already follow/i.test(refusal)) {
        already++;
      } else {
        capped++;
      }
    }
    return { added, skipped: this.excluded().length, capped, already };
  }

  private patch(userId: string, changes: Partial<ImportCandidate>): void {
    this.candidates.update((all) =>
      all.map((candidate) =>
        candidate.userId === userId ? { ...candidate, ...changes } : candidate,
      ),
    );
  }
}

/**
 * A wire followings entry as a candidate, or null when it is unusable.
 *
 * The handle arrives as `screen_name` here and `userName` elsewhere in the same
 * API, so both are accepted. An entry with neither, or with no id, cannot be
 * followed or checked and is dropped.
 */
export function toCandidate(user: WireFollowing): ImportCandidate | null {
  const username = user.screen_name ?? user.userName;
  if (!username || !user.id) {
    return null;
  }
  return {
    userId: user.id,
    username,
    displayName: user.name || username,
    avatar: user.profile_image_url_https,
    statusesCount: user.statuses_count ?? 0,
    protected: user.protected === true,
    excluded: null,
    checked: false,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
