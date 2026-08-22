import { computed, inject, Injectable, signal } from '@angular/core';
import { PlusSession } from '../account/plus-session';

/**
 * How many articles a free reader may expand per day.
 *
 * ## What this is and is not
 *
 * It is a nudge, not an enforcement boundary. The counter lives in
 * `localStorage`, so anyone who wants more can clear it, and that is fine — it
 * is consistent with the rest of this app, which is anonymous by design and has
 * no server that could count on the user's behalf. Real enforcement would mean
 * per-account counting in the proxy, and the proxy deliberately does not do that
 * (see the note in `plus/usage.ts` about an approximate counter never becoming
 * a ceiling).
 *
 * What it does buy is an honest answer to "does this work?" before anyone pays
 * for it. Two articles is enough to find out; it is not enough to read a feed
 * with.
 *
 * ## What does not count
 *
 * Only a rendered article. Specifically **not**:
 *
 * - a cache hit, because re-reading something already fetched must be free or
 *   the feature feels punitive;
 * - a failure of any kind, because spending one of two daily articles on a
 *   Cloudflare challenge page is the fastest way to make a paid feature feel
 *   like a scam;
 * - a result the quality gate rejected, because the reader got a card, not an
 *   article, and charging for that invites a refund request.
 *
 * The call site therefore consumes *after* a successful render, never before
 * the fetch.
 */

/** Registered in `storage-registry.ts` as `cache`. */
export const ARTICLE_QUOTA_KEY = 'mockingbird_article_quota';

/** Free expansions per calendar day. */
export const FREE_DAILY_ARTICLES = 2;

interface StoredQuota {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  count: number;
}

/** Today, in the reader's own timezone. */
function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

@Injectable({ providedIn: 'root' })
export class ArticleQuota {
  private plus = inject(PlusSession);

  /** Today's count, as a signal so the UI updates when it is spent. */
  private used = signal(this.read().count);

  /** True after the supporter service has answered for this page load. */
  private entitlementChecked = signal(false);

  /** One shared lookup when construction and a click happen together. */
  private entitlementCheck: Promise<void> | null = null;

  /** True while an exhausted counter may still turn out to belong to a supporter. */
  readonly checkingEntitlement = signal(false);

  /**
   * Whether this reader is exempt.
   *
   * A lapsed subscription silently returns them to the free limit rather than
   * breaking anything, which is the same posture the proxy takes.
   */
  readonly unlimited = computed(() => this.plus.isSupporter());

  /** Expansions left today. `Infinity` for supporters. */
  readonly remaining = computed(() =>
    this.unlimited() ? Infinity : Math.max(0, FREE_DAILY_ARTICLES - this.used()),
  );

  /**
   * Whether the fetch control should remain available.
   *
   * An exhausted counter stays available while entitlement is being checked.
   * Disabling it sooner creates a deadlock: the subscriber cannot make the
   * proxied request that would otherwise discover their subscription.
   */
  readonly allowed = computed(() => this.checkingEntitlement() || this.remaining() > 0);

  constructor() {
    // A browser can arrive with yesterday's session gone from memory but
    // today's local counter already exhausted. Start the lookup immediately so
    // a returning subscriber is unlocked without having to visit Settings.
    if (this.remaining() === 0) {
      void this.checkEntitlement();
    }
  }

  /**
   * Settle the account tier before deciding whether this expansion is allowed.
   *
   * `PlusSession` deliberately starts at `free`: entitlement is an account
   * fact, not something safe to persist in local storage. The reader must
   * therefore refresh the tier at its own gate instead of assuming the initial
   * value is authoritative. The lookup is shared with the constructor's
   * exhausted-counter check. A supporter already confirmed in this app session
   * needs no second lookup.
   */
  async authorize(): Promise<boolean> {
    await this.checkEntitlement();
    return this.remaining() > 0;
  }

  /** Perform the entitlement lookup once for this instance. */
  private checkEntitlement(): Promise<void> {
    if (this.entitlementChecked()) {
      return Promise.resolve();
    }
    if (this.plus.isSupporter()) {
      this.entitlementChecked.set(true);
      return Promise.resolve();
    }
    if (this.entitlementCheck) {
      return this.entitlementCheck;
    }

    this.checkingEntitlement.set(true);
    this.entitlementCheck = this.plus
      // `refresh()`, not `token()`: a fresh held free token can predate a
      // subscription bought in another tab. Reusing it would make this lookup
      // confidently repeat the same stale answer for up to fifteen minutes.
      .refresh()
      .then(() => undefined)
      // PlusSession normally resolves failures to null. Keep the quota gate
      // defensive too: an account-service outage must settle to the free
      // posture, not become an unhandled rejection from the constructor.
      .catch(() => undefined)
      .finally(() => {
        this.entitlementChecked.set(true);
        this.checkingEntitlement.set(false);
        this.entitlementCheck = null;
      });
    return this.entitlementCheck;
  }

  /** Today's stored counter, resetting a stale day on read. */
  private read(): StoredQuota {
    const fresh: StoredQuota = { day: today(), count: 0 };
    let raw: string | null;
    try {
      raw = localStorage.getItem(ARTICLE_QUOTA_KEY);
    } catch {
      // Private-mode or blocked storage: behave as if today is fresh. The
      // alternative — refusing the feature — punishes the wrong people.
      return fresh;
    }
    if (!raw) {
      return fresh;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredQuota>;
      if (parsed.day !== today() || typeof parsed.count !== 'number') {
        return fresh;
      }
      return { day: parsed.day, count: parsed.count };
    } catch {
      return fresh;
    }
  }

  /**
   * Record one rendered article.
   *
   * Call only after an article was actually shown. Returns the new remaining
   * count so a caller can message it without a second read.
   */
  consume(): number {
    if (this.unlimited()) {
      return Infinity;
    }
    const next = this.read().count + 1;
    this.used.set(next);
    try {
      localStorage.setItem(ARTICLE_QUOTA_KEY, JSON.stringify({ day: today(), count: next }));
    } catch {
      // A counter we cannot persist is a counter that resets on reload. Not
      // worth failing the read the user already paid for.
    }
    return Math.max(0, FREE_DAILY_ARTICLES - next);
  }

  /** Re-read from storage, for a browser that changed it in another tab. */
  refresh(): void {
    this.used.set(this.read().count);
    if (this.remaining() === 0) {
      void this.checkEntitlement();
    }
  }
}
