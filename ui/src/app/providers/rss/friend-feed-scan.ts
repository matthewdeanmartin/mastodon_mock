/**
 * Finds the feeds behind the links on the profiles of everyone you follow, and
 * compiles them into an OPML file.
 *
 * ## What this actually does
 *
 * Fediverse profiles carry up to four free-form fields, and people put their
 * homepage in them. That makes the following list a directory of your friends'
 * websites that nobody has ever read as one — the information is already there,
 * spread across hundreds of profiles, and looking at it by hand is not a thing
 * anyone would do.
 *
 * So: walk the following list, collect the field URLs, ask each site whether it
 * publishes a feed, and hand back an OPML file of the ones that do.
 *
 * ## Why this is a service and not a component
 *
 * Same reason as {@link ../../audience-scan}: the job is minutes long and it
 * must survive the dialog being closed. Being root-provided also means the
 * progress signals are still there when the dialog is reopened, so closing it
 * by accident does not throw away a scan someone paid for.
 *
 * ## Where the money goes
 *
 * The graph walk is cheap — {@link PAGE_SIZE} accounts per request, so a
 * 2,000-following account is about 25 calls — and it always runs to completion,
 * because stopping early would mean silently ignoring some of the people you
 * follow.
 *
 * The probes are the expensive half: one cross-origin fetch of a stranger's
 * homepage each, mostly through the shared CORS proxy. That is what the user's
 * cap limits, what makes this Plus-only, and what the consent step quotes.
 *
 * Three things keep the bill down, in the order they apply:
 *
 *   1. **The skip list** (`friend-feed-skip-list.ts`) drops hosts that certainly
 *      have no per-profile feed before anything is fetched.
 *   2. **The probe cache** (`friend-feed-cache.ts`) skips every URL already
 *      probed in an earlier scan, hit *or* miss. This is what makes a re-scan
 *      after following ten people cost about ten probes.
 *   3. **Deduplication by normalized URL**, so twenty friends who all link the
 *      same group blog cost one probe between them.
 *
 * Probes run sequentially. A burst of cross-origin fetches is exactly what a
 * free proxy rate-limits, which is the same reasoning as `rss-discovery.ts` and
 * the OPML importer.
 *
 * ## Stopping early is a real answer
 *
 * Like an audience scan and unlike a bulk write, a partial run still produces
 * something worth having: the feeds found so far are just as valid as the ones
 * a complete run would have found. So stopping keeps the result and marks it
 * {@link FriendOpmlRecord.partial}, and the dialog says which it is rather than
 * presenting a sample as a census.
 */

import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../api';
import { Account } from '../../models';
import { PageDiagnostics } from '../../page-diagnostics';
import { CorsProxy } from '../cors-proxy/cors-proxy';
import {
  FoundFeed,
  FriendFeedCache,
  FriendOpmlRecord,
  normalizeProfileUrl,
} from './friend-feed-cache';
import { isSkippedHost } from './friend-feed-skip-list';
import { buildOpml } from './opml';
import { PasteResolve } from './paste-resolve';
import { RssFeedSub } from './rss-subscriptions';

/** Mastodon caps following pages at 80. */
const PAGE_SIZE = 80;

/**
 * Hard ceiling on graph pages (80 × 200 = 16,000 accounts).
 *
 * A guard against a server handing out cursors forever, not a product limit —
 * it sits far past any following list this app will meet, and the result is
 * marked partial if it is ever hit.
 */
const MAX_PAGES = 200;

/** Probe budgets offered in the dialog. */
export const PROBE_CAPS = [100, 250, 500, 1000] as const;

/** The default offered, and what the consent copy quotes. */
export const DEFAULT_PROBE_CAP = 500;

/** How far along a running scan is. */
export interface FriendScanProgress {
  phase: 'walking' | 'probing' | 'done' | 'cancelled' | 'failed';
  /** Accounts read from the following list. */
  accountsWalked: number;
  /** What the server says the following total is — the walk's denominator. */
  accountsTotal: number;
  /** Profile URLs probed so far this run. */
  probed: number;
  /** Profile URLs this run intends to probe — the probing denominator. */
  probeTarget: number;
  /** Feeds found so far, across cache hits and fresh probes. */
  found: number;
  /** Probes skipped because an earlier scan had already answered them. */
  fromCache: number;
  error?: string;
}

/** What a finished scan produced. */
export interface FriendScanResult {
  feeds: FoundFeed[];
  opml: string;
  generatedAt: number;
  checkedCount: number;
  partial: boolean;
}

@Injectable({ providedIn: 'root' })
export class FriendFeedScan {
  private api = inject(Api);
  private cache = inject(FriendFeedCache);
  private resolver = inject(PasteResolve);
  private proxy = inject(CorsProxy);
  private diagnostics = inject(PageDiagnostics);

  /** Live progress, or null before anything has run. */
  readonly progress = signal<FriendScanProgress | null>(null);

  /** The finished result, from this session's scan or the stored one. */
  readonly result = signal<FriendScanResult | null>(null);

  readonly running = computed(() => {
    const phase = this.progress()?.phase;
    return phase === 'walking' || phase === 'probing';
  });

  /**
   * Overall completion, 0–1, or null when nothing is known.
   *
   * The walk and the probes are weighted rather than averaged: the walk is a
   * small fraction of the wall-clock time, so showing it as half the bar would
   * make the progress indicator lie for the whole expensive part.
   */
  readonly percent = computed<number | null>(() => {
    const progress = this.progress();
    if (!progress) {
      return null;
    }
    const walk =
      progress.accountsTotal > 0
        ? Math.min(1, progress.accountsWalked / progress.accountsTotal)
        : 0;
    const probe =
      progress.probeTarget > 0 ? Math.min(1, progress.probed / progress.probeTarget) : 0;
    return Math.min(1, walk * WALK_WEIGHT + probe * (1 - WALK_WEIGHT));
  });

  private cancelRequested = false;

  /** Whether a scan can run at all: it needs somewhere to send its fetches. */
  available(): boolean {
    return this.proxy.available();
  }

  /** Ask a running scan to stop. Keeps whatever it has found. */
  stop(): void {
    this.cancelRequested = true;
  }

  /** Load the stored OPML for this account into {@link result}, if there is one. */
  async loadStored(accountKey: string): Promise<FriendScanResult | null> {
    const record = await this.cache.opml(accountKey);
    if (!record) {
      return null;
    }
    const feeds = await this.storedFeeds();
    const loaded: FriendScanResult = {
      feeds,
      opml: record.opml,
      generatedAt: record.generatedAt,
      checkedCount: record.checkedCount,
      partial: record.partial,
    };
    this.result.set(loaded);
    return loaded;
  }

  /** Throw away this account's OPML and every probe, so the next scan starts fresh. */
  async forget(accountKey: string): Promise<void> {
    await this.cache.clear(accountKey);
    this.result.set(null);
    this.progress.set(null);
  }

  /**
   * Walk the following list, probe what is new, and compile the OPML.
   *
   * `cap` is a ceiling on *fresh probes*, not on accounts: cache hits and
   * skip-listed hosts cost nothing and do not count against it. That is the
   * honest unit, because it is the one that maps to requests.
   */
  async scan(accountId: string, accountKey: string, cap: number): Promise<FriendScanResult | null> {
    if (this.running()) {
      return this.result();
    }
    this.cancelRequested = false;
    this.progress.set({
      phase: 'walking',
      accountsWalked: 0,
      accountsTotal: 0,
      probed: 0,
      probeTarget: 0,
      found: 0,
      fromCache: 0,
    });

    try {
      const accounts = await this.walkFollowing(accountId);
      if (this.cancelRequested) {
        return this.finish(accountKey, [], 0, true);
      }

      // Normalized URL -> the first handle that linked it. Deduping here is
      // what makes twenty friends linking one group blog cost a single probe,
      // and keeping the first handle keeps the attribution truthful.
      const targets = new Map<string, { raw: string; via: string }>();
      for (const account of accounts) {
        for (const field of account.fields ?? []) {
          const raw = urlIn(field.value);
          if (!raw) {
            continue;
          }
          const key = normalizeProfileUrl(raw);
          if (key && !targets.has(key) && !isSkippedHost(key)) {
            targets.set(key, { raw, via: account.acct });
          }
        }
      }

      const known = await this.cache.probes();
      const found: FoundFeed[] = [];
      let fromCache = 0;
      const pending: { key: string; raw: string; via: string }[] = [];

      for (const [key, target] of targets) {
        const record = known.get(key);
        // `unreachable` is the one outcome worth asking about again: the site
        // was never actually answered, so believing it would bake one bad
        // afternoon into a permanent "no feed".
        if (record && record.outcome !== 'unreachable') {
          fromCache++;
          found.push(...record.feeds);
          continue;
        }
        pending.push({ key, ...target });
      }

      const budget = pending.slice(0, cap);
      this.progress.update((p) =>
        p
          ? {
              ...p,
              phase: 'probing',
              probeTarget: budget.length,
              found: found.length,
              fromCache,
            }
          : p,
      );

      for (const target of budget) {
        if (this.cancelRequested) {
          break;
        }
        const feeds = await this.probe(target.key, target.raw, target.via);
        found.push(...feeds);
        this.progress.update((p) => (p ? { ...p, probed: p.probed + 1, found: found.length } : p));
      }

      // Partial when the user stopped it, or when the cap left probes unspent.
      const partial = this.cancelRequested || budget.length < pending.length;
      return this.finish(accountKey, found, targets.size, partial);
    } catch (error) {
      this.diagnostics.warn('FriendFeedScan', 'scan:failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      this.progress.update((p) =>
        p ? { ...p, phase: 'failed', error: 'The scan could not finish.' } : p,
      );
      return null;
    }
  }

  /** Read the whole following list, one page at a time. */
  private async walkFollowing(accountId: string): Promise<Account[]> {
    const accounts: Account[] = [];
    let maxId: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      if (this.cancelRequested) {
        break;
      }
      const result = await firstValueFrom(
        this.api.accountFollowingPage(accountId, maxId, PAGE_SIZE),
      );
      accounts.push(...result.accounts);
      this.progress.update((p) =>
        p
          ? {
              ...p,
              accountsWalked: accounts.length,
              accountsTotal: Math.max(p.accountsTotal, accounts.length),
            }
          : p,
      );
      if (!result.nextMaxId || result.accounts.length === 0) {
        break;
      }
      maxId = result.nextMaxId;
    }
    return accounts;
  }

  /**
   * Ask one site whether it publishes a feed, and remember the answer.
   *
   * Delegates to {@link PasteResolve}, which already tries the site directly
   * before falling back to the CORS proxy and caches within the session. Using
   * it rather than a second probe path means the scan and the paste box agree
   * about what a site publishes, which they would eventually stop doing if this
   * grew its own copy.
   */
  private async probe(key: string, raw: string, via: string): Promise<FoundFeed[]> {
    let resolution;
    try {
      resolution = await this.resolver.resolve(raw);
    } catch {
      await this.cache.recordProbe(key, 'unreachable');
      return [];
    }

    if (resolution.kind !== 'feeds' || resolution.feeds.length === 0) {
      // `account`, `suggestion` and `none` all mean the same thing here: the
      // page was reached and there was no feed on it to subscribe to. Recorded
      // as `none` so it is believed and never probed again — unlike the
      // `unreachable` written above, which is retried.
      await this.cache.recordProbe(key, 'none');
      return [];
    }

    const feeds: FoundFeed[] = resolution.feeds.map((feed) => ({
      url: feed.url,
      title: feed.title || hostOf(feed.url),
      ...(resolution.needsProxy ? { useProxy: true } : {}),
      siteUrl: resolution.siteUrl,
      via,
    }));
    await this.cache.recordProbe(key, 'feeds', feeds);
    return feeds;
  }

  /** Every feed the probe cache holds, for reopening a stored result. */
  private async storedFeeds(): Promise<FoundFeed[]> {
    const records = await this.cache.probes();
    const feeds: FoundFeed[] = [];
    for (const record of records.values()) {
      feeds.push(...record.feeds);
    }
    return dedupeByUrl(feeds);
  }

  /** Compile, store and publish the result. */
  private async finish(
    accountKey: string,
    found: FoundFeed[],
    checkedCount: number,
    partial: boolean,
  ): Promise<FriendScanResult> {
    const feeds = dedupeByUrl(found);
    const generatedAt = Date.now();
    const opml = buildOpml(feeds.map(toSubscription), new Date(generatedAt));

    const record: FriendOpmlRecord = {
      accountKey,
      opml,
      generatedAt,
      feedCount: feeds.length,
      checkedCount,
      partial,
    };
    await this.cache.saveOpml(record);

    const result: FriendScanResult = {
      feeds,
      opml,
      generatedAt,
      checkedCount,
      partial,
    };
    this.result.set(result);
    this.progress.update((p) =>
      p ? { ...p, phase: this.cancelRequested ? 'cancelled' : 'done', found: feeds.length } : p,
    );
    this.diagnostics.info('FriendFeedScan', 'scan:finished', {
      feeds: feeds.length,
      checked: checkedCount,
      partial,
    });
    return result;
  }
}

/**
 * How much of the progress bar the graph walk is worth.
 *
 * The walk is a handful of fast API calls; the probes are hundreds of slow
 * cross-origin fetches. Weighting them equally would park the bar at 50% for
 * the entire expensive half, which reads as a hang.
 */
const WALK_WEIGHT = 0.1;

/**
 * Pull a URL out of a profile field value.
 *
 * Mastodon renders field values as HTML — a link is `<a href="…">label</a>` —
 * but servers vary and plenty send a bare string. Both are handled: the `href`
 * when there is one, otherwise the trimmed text, which
 * {@link normalizeProfileUrl} then accepts or rejects.
 */
function urlIn(value: string): string | null {
  const href = /href="([^"]+)"/i.exec(value);
  if (href) {
    return href[1];
  }
  const text = value.replace(/<[^>]*>/g, '').trim();
  return text || null;
}

/** A feed URL's host, for a feed that gave no title of its own. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** First occurrence wins, so the earliest attribution is the one kept. */
function dedupeByUrl(feeds: readonly FoundFeed[]): FoundFeed[] {
  const seen = new Map<string, FoundFeed>();
  for (const feed of feeds) {
    if (!seen.has(feed.url)) {
      seen.set(feed.url, feed);
    }
  }
  return [...seen.values()];
}

/** Shape a found feed as the subscription record {@link buildOpml} expects. */
function toSubscription(feed: FoundFeed): RssFeedSub {
  return {
    url: feed.url,
    title: feed.title,
    enabled: true,
    ...(feed.useProxy ? { useProxy: true } : {}),
  };
}
