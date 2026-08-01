import { computed, Injectable, signal } from '@angular/core';
import {
  credentialExpired,
  credentialExpiresAt,
  ExpiringConnection,
  ExpiringCredential,
  stampCredential,
} from '../credential-lifetime';
import { TwitterSourceEntry, TwitterSourceId, twitterSourceEntry } from './twitter-source';

/**
 * Which Twitter data service this browser uses, and the key for it.
 *
 * Modelled directly on {@link ShortenerSettings}, including the split storage:
 *
 * - `mockingbird_twitter` — the active source id and the recorded verdict of the
 *   direct-reachability probe. Ordinary configuration, exportable.
 * - `mockingbird_twitter_keys` — the API keys, one per source. Secrets: never
 *   exported, and governed by the credential retention policy.
 *
 * ## Why the key is not account-scoped
 *
 * Same reasoning as OpenRouter, the CORS proxy and the shorteners: a paid API
 * subscription belongs to the *human* holding the credit balance, not to a
 * Mastodon persona. Re-pasting it per alt would be busywork protecting nothing,
 * since either alt reads the other's copy out of the same localStorage. The
 * *follows* built on top of it are account-scoped — those are a persona's
 * reading list — but the key is not.
 *
 * ## Why the probe verdict is persisted
 *
 * These services cannot be called from a browser at all: their preflight demands
 * the very API-key header a preflight is forbidden to carry. Re-discovering that
 * on every request would mean a guaranteed-failing request, and several seconds
 * of waiting, before every real one. So the connector page probes *once*, the
 * verdict is recorded here, and the transport reads it instead of re-testing.
 *
 * It lives with the config rather than the key because it is a fact about the
 * *service*, not about the user's credential: it stays true when the key is
 * rotated, and it must survive the key ageing out.
 */

const CONFIG_KEY = 'mockingbird_twitter';
const SECRET_KEY = 'mockingbird_twitter_keys';

/** What a direct (unproxied) browser request to a source was observed to do. */
export type DirectReachability =
  /** Never tested from this browser. */
  | 'untested'
  /** A direct request reached the service. Astonishing, but honour it. */
  | 'reachable'
  /** A direct request could not reach it — the expected result. */
  | 'blocked';

/** The non-secret half: which source, and what we learned about reaching it. */
interface StoredTwitterConfig {
  active: TwitterSourceId | null;
  /** Probe verdict per source. */
  direct?: Partial<Record<TwitterSourceId, DirectReachability>>;
}

/** One source's key. */
interface StoredTwitterKey extends ExpiringCredential {
  key: string;
}

type StoredKeys = Partial<Record<TwitterSourceId, StoredTwitterKey>>;

/** Everything the transport needs to build a request. */
export interface TwitterConfig {
  entry: TwitterSourceEntry;
  /** The auth header to send. Never null: every source here requires a key. */
  auth: { header: string; value: string };
}

@Injectable({ providedIn: 'root' })
export class TwitterSettings implements ExpiringConnection {
  private config = signal<StoredTwitterConfig>(readConfig());
  private keys = signal<StoredKeys>(readKeys());

  /** The active source's catalog entry, or null when none is chosen. */
  readonly chosen = computed<TwitterSourceEntry | null>(
    () => twitterSourceEntry(this.config().active) ?? null,
  );

  /** Whether the active source is configured well enough to be used. */
  readonly usable = computed(() => this.resolve() !== null);

  /** Source ids holding a key, so the picker can mark them up. */
  readonly configured = computed<TwitterSourceId[]>(
    () =>
      Object.keys(this.keys()).filter(
        (id) => this.keys()[id as TwitterSourceId]?.key,
      ) as TwitterSourceId[],
  );

  constructor() {
    this.enforceLifetime();
  }

  activeId(): TwitterSourceId | null {
    return this.config().active;
  }

  /** Whether a key is stored for a source, without exposing it. */
  hasKey(id: TwitterSourceId): boolean {
    return (this.keys()[id]?.key ?? '') !== '';
  }

  /** What the direct-reachability probe last observed for a source. */
  directReachability(id: TwitterSourceId): DirectReachability {
    return this.config().direct?.[id] ?? 'untested';
  }

  /**
   * Record what a direct probe observed.
   *
   * Called only by {@link TwitterReachability}, after an actual request. The
   * app must never write `blocked` from a guess — the whole point is that the
   * user watched it happen.
   */
  recordDirectReachability(id: TwitterSourceId, verdict: DirectReachability): void {
    const direct = { ...this.config().direct, [id]: verdict };
    this.writeConfig({ ...this.config(), direct });
  }

  /**
   * Everything needed to talk to the active source, or null when it cannot be
   * used yet.
   *
   * Null rather than a half-built config when the key is missing, so callers
   * produce "finish setting up TwitterAPI.io" instead of firing a request that
   * can only 401 — and, since every call costs money, one that would be billed.
   */
  resolve(): TwitterConfig | null {
    const entry = this.chosen();
    if (!entry) {
      return null;
    }
    const key = this.keys()[entry.id]?.key ?? '';
    if (!key) {
      return null;
    }
    return {
      entry,
      auth: { header: entry.authHeader, value: `${entry.authPrefix}${key}` },
    };
  }

  /** Why {@link resolve} returned null, phrased for the user. Null when it did not. */
  blockedReason(): string | null {
    const entry = this.chosen();
    if (!entry) {
      return 'No Twitter data service is connected yet.';
    }
    if (!this.hasKey(entry.id)) {
      return `Add your ${entry.label} API key to start reading Twitter data.`;
    }
    return null;
  }

  /** Make a source the active one. Leaves every stored key in place. */
  activate(id: TwitterSourceId): void {
    this.writeConfig({ ...this.config(), active: id });
  }

  /** Stop using any source, keeping keys so switching back is cheap. */
  deactivate(): void {
    this.writeConfig({ ...this.config(), active: null });
  }

  /**
   * Store a source's key, stamped for the retention policy.
   *
   * An empty key clears the stored one rather than persisting a blank, so the
   * field doubles as the way to remove a key.
   */
  setKey(id: TwitterSourceId, key: string): void {
    const trimmed = key.trim();
    if (!trimmed) {
      this.clearKey(id);
      return;
    }
    this.writeKeys({ ...this.keys(), [id]: stampCredential({ key: trimmed }) });
  }

  clearKey(id: TwitterSourceId): void {
    const next = { ...this.keys() };
    delete next[id];
    this.writeKeys(next);
    if (this.config().active === id) {
      this.deactivate();
    }
  }

  /**
   * Forget a source entirely: its key and its probe verdict.
   *
   * The verdict goes too, because "forget this service" should leave no trace
   * that it was ever configured — and because a user who disconnects and
   * reconnects is often doing so precisely to re-test it.
   */
  forget(id: TwitterSourceId): void {
    const direct = { ...this.config().direct };
    delete direct[id];
    this.writeConfig({
      active: this.config().active === id ? null : this.config().active,
      direct,
    });
    const keys = { ...this.keys() };
    delete keys[id];
    this.writeKeys(keys);
  }

  /** {@link ExpiringConnection}: drop keys that outlive the policy. */
  enforceLifetime(): void {
    const keys = this.keys();
    const kept = Object.fromEntries(
      Object.entries(keys).filter(([, stored]) => !credentialExpired(stored?.connectedAt)),
    ) as StoredKeys;
    if (Object.keys(kept).length !== Object.keys(keys).length) {
      this.writeKeys(kept);
      const active = this.config().active;
      if (active && !kept[active]) {
        this.deactivate();
      }
    }
  }

  /** {@link ExpiringConnection}: when the *active* key ages out. */
  expiresAt(): number | null {
    const active = this.config().active;
    return active ? credentialExpiresAt(this.keys()[active]?.connectedAt) : null;
  }

  private writeConfig(next: StoredTwitterConfig): void {
    this.config.set(next);
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    } catch {
      // Non-persistent, but honour it for this session.
    }
  }

  private writeKeys(next: StoredKeys): void {
    this.keys.set(next);
    try {
      if (Object.keys(next).length) {
        localStorage.setItem(SECRET_KEY, JSON.stringify(next));
      } else {
        localStorage.removeItem(SECRET_KEY);
      }
    } catch {
      // Honoured for this session only.
    }
  }
}

function readConfig(): StoredTwitterConfig {
  const empty: StoredTwitterConfig = { active: null };
  let raw: string | null;
  try {
    raw = localStorage.getItem(CONFIG_KEY);
  } catch {
    return empty;
  }
  if (!raw) {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw) as StoredTwitterConfig;
    // A source we no longer ship is discarded rather than kept dangling.
    const active = twitterSourceEntry(parsed?.active) ? parsed.active : null;
    return { active, direct: parsed?.direct ?? {} };
  } catch {
    return empty;
  }
}

function readKeys(): StoredKeys {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SECRET_KEY);
  } catch {
    return {};
  }
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as StoredKeys;
    const kept: StoredKeys = {};
    for (const [id, stored] of Object.entries(parsed ?? {})) {
      if (
        twitterSourceEntry(id as TwitterSourceId) &&
        typeof stored?.key === 'string' &&
        stored.key
      ) {
        kept[id as TwitterSourceId] = stored;
      }
    }
    // Backfill stamps on records written before the retention policy existed.
    let backfilled = false;
    for (const id of Object.keys(kept) as TwitterSourceId[]) {
      const record = kept[id];
      if (record && typeof record.connectedAt !== 'number') {
        kept[id] = { ...record, connectedAt: Date.now() };
        backfilled = true;
      }
    }
    if (backfilled) {
      try {
        localStorage.setItem(SECRET_KEY, JSON.stringify(kept));
      } catch {
        // The in-memory stamps still bound this session.
      }
    }
    return kept;
  } catch {
    try {
      localStorage.removeItem(SECRET_KEY);
    } catch {
      // Unreadable and unremovable is still "no keys" in memory.
    }
    return {};
  }
}
