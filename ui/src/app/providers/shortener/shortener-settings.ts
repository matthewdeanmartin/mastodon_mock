import { computed, Injectable, signal } from '@angular/core';
import {
  credentialExpired,
  credentialExpiresAt,
  ExpiringConnection,
  ExpiringCredential,
  stampCredential,
} from '../credential-lifetime';
import { ShortenerCatalogEntry, shortenerEntry } from './shortener-catalog';
import { ShortenerId } from './shortener-provider';

/**
 * Which shortener this browser uses, and the key for it.
 *
 * Modelled directly on {@link CorsProxySettings}, including the split storage:
 *
 * - `mockingbird_shortener` — the active provider id and its non-secret options
 *   (the short domain). Ordinary configuration, exportable.
 * - `mockingbird_shortener_keys` — the API keys, one per provider. Secrets:
 *   never exported, and governed by the credential retention policy.
 *
 * ## Why keys are kept per provider while only one is active
 *
 * The spec asks for several services configured with exactly one active. Wiping
 * a key every time you switch would make "try Dub for a week, switch back" mean
 * re-issuing tokens, so keys persist per provider and the active id is a
 * separate, cheap choice. The cost is that a disused key keeps sitting in
 * localStorage, which is precisely what the retention policy is for — each key
 * carries its own `connectedAt` and ages out on its own schedule, whether or not
 * it is the active one.
 *
 * ## Precedence
 *
 * The spec says "when a provider with a key is active, that one takes
 * precedence". Every provider here needs a key, so precedence reduces to: the
 * active provider is used when its key is present, and otherwise the app has no
 * shortener and says so. The pre-existing key-free TinyURL shortener is
 * deliberately *not* a fallback for these — it encodes a whole message into a
 * redirect target and cannot shorten an arbitrary URL on request. It stays in
 * the paste providers where it belongs, and only its history is shared with the
 * Links page.
 *
 * ## Why the key is not account-scoped
 *
 * Same reasoning as OpenRouter and the CORS proxy: a shortener subscription
 * belongs to the human paying for it, not to a Mastodon persona. Re-pasting it
 * per alt would be busywork protecting nothing, since either alt can read the
 * other's copy out of the same localStorage.
 */

const CONFIG_KEY = 'mockingbird_shortener';
const SECRET_KEY = 'mockingbird_shortener_keys';

/** The non-secret half: which provider, and the short domain per provider. */
interface StoredShortenerConfig {
  active: ShortenerId | null;
  /** Short domain per provider. Not a secret — it is in every link you publish. */
  domains?: Partial<Record<ShortenerId, string>>;
}

/** One provider's key. */
interface StoredShortenerKey extends ExpiringCredential {
  key: string;
}

type StoredKeys = Partial<Record<ShortenerId, StoredShortenerKey>>;

/** Everything an adapter needs to build an authenticated request. */
export interface ShortenerConfig {
  entry: ShortenerCatalogEntry;
  /** The header value, prefix already applied. */
  authorization: string;
  /** The configured short domain, or '' when the provider's default is used. */
  domain: string;
}

@Injectable({ providedIn: 'root' })
export class ShortenerSettings implements ExpiringConnection {
  private config = signal<StoredShortenerConfig>(readConfig());
  private keys = signal<StoredKeys>(readKeys());

  /** The active provider's catalog entry, or null when none is chosen. */
  readonly chosen = computed<ShortenerCatalogEntry | null>(
    () => shortenerEntry(this.config().active) ?? null,
  );

  /** Whether the active provider is configured well enough to be used. */
  readonly usable = computed(() => this.resolve() !== null);

  /** Provider ids holding a key, so the picker can mark them up. */
  readonly configured = computed<ShortenerId[]>(
    () =>
      Object.keys(this.keys()).filter((id) => this.keys()[id as ShortenerId]?.key) as ShortenerId[],
  );

  constructor() {
    this.enforceLifetime();
  }

  activeId(): ShortenerId | null {
    return this.config().active;
  }

  /** Whether a key is stored for a provider, without exposing it. */
  hasKey(id: ShortenerId): boolean {
    return (this.keys()[id]?.key ?? '') !== '';
  }

  /** The stored short domain for a provider, for the settings form to prefill. */
  domain(id: ShortenerId): string {
    return this.config().domains?.[id] ?? '';
  }

  /**
   * Everything needed to talk to the active provider, or null when it cannot be
   * used yet.
   *
   * Null rather than a half-built config when the key is missing, or when the
   * provider requires a short domain and none is set. Short.io is the case that
   * matters: its create endpoint rejects a request with no domain, and failing
   * here produces "finish setting up Short.io" instead of a validation error
   * from the provider that reads like the destination URL was wrong.
   */
  resolve(): ShortenerConfig | null {
    const entry = this.chosen();
    if (!entry) {
      return null;
    }
    const key = this.keys()[entry.id]?.key ?? '';
    if (!key) {
      return null;
    }
    const domain = this.domain(entry.id);
    if (entry.domainRequired && !domain) {
      return null;
    }
    return { entry, authorization: `${entry.auth.prefix}${key}`, domain };
  }

  /** Why {@link resolve} returned null, phrased for the user. Null when it did not. */
  blockedReason(): string | null {
    const entry = this.chosen();
    if (!entry) {
      return 'No link shortener is connected yet.';
    }
    if (!this.hasKey(entry.id)) {
      return `Add your ${entry.label} ${entry.keyLabel} to start shortening links.`;
    }
    if (entry.domainRequired && !this.domain(entry.id)) {
      return `${entry.label} needs the short domain from your account before it can create links.`;
    }
    return null;
  }

  /** Make a provider the active one. Leaves every stored key in place. */
  activate(id: ShortenerId): void {
    this.writeConfig({ ...this.config(), active: id });
  }

  /** Stop using any shortener, keeping keys so switching back is cheap. */
  deactivate(): void {
    this.writeConfig({ ...this.config(), active: null });
  }

  setDomain(id: ShortenerId, domain: string): void {
    const domains = { ...this.config().domains, [id]: domain.trim() };
    this.writeConfig({ ...this.config(), domains });
  }

  /**
   * Store a provider's key, stamped for the retention policy.
   *
   * An empty key clears the stored one rather than persisting a blank, so the
   * field doubles as the way to remove a key.
   */
  setKey(id: ShortenerId, key: string): void {
    const trimmed = key.trim();
    if (!trimmed) {
      this.clearKey(id);
      return;
    }
    this.writeKeys({ ...this.keys(), [id]: stampCredential({ key: trimmed }) });
  }

  clearKey(id: ShortenerId): void {
    const next = { ...this.keys() };
    delete next[id];
    this.writeKeys(next);
    if (this.config().active === id) {
      this.deactivate();
    }
  }

  /** Forget a provider entirely: its key and its domain. */
  forget(id: ShortenerId): void {
    const domains = { ...this.config().domains };
    delete domains[id];
    this.writeConfig({
      active: this.config().active === id ? null : this.config().active,
      domains,
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

  /**
   * {@link ExpiringConnection}: when the *active* key ages out.
   *
   * The active one specifically, because that is the connection the settings
   * page is describing. A dormant key for a provider you are not using expires
   * on its own schedule and is not what "expires in 12 days" should mean.
   */
  expiresAt(): number | null {
    const active = this.config().active;
    return active ? credentialExpiresAt(this.keys()[active]?.connectedAt) : null;
  }

  private writeConfig(next: StoredShortenerConfig): void {
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

function readConfig(): StoredShortenerConfig {
  const empty: StoredShortenerConfig = { active: null };
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
    const parsed = JSON.parse(raw) as StoredShortenerConfig;
    // A provider we no longer ship is discarded rather than kept dangling.
    const active = shortenerEntry(parsed?.active) ? parsed.active : null;
    return { active, domains: parsed?.domains ?? {} };
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
      if (shortenerEntry(id as ShortenerId) && typeof stored?.key === 'string' && stored.key) {
        kept[id as ShortenerId] = stored;
      }
    }
    // Backfill stamps on records written before the retention policy existed.
    // `ensureStamped` handles one credential; this store holds a map of them, so
    // the backfill is per entry and the map is persisted once at the end.
    let backfilled = false;
    for (const id of Object.keys(kept) as ShortenerId[]) {
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
