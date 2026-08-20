/**
 * What Mawkingbird Plus is actually holding, and what it has actually done.
 *
 * ## Why this exists
 *
 * Sync is invisible when it works. Settings save, collections match, and
 * nothing anywhere says whether a single byte reached the server — so
 * "is this doing anything at all?" had no answer outside the unit tests. That
 * is a bad place for a paid feature to be: it is indistinguishable from broken,
 * and the only person who can tell the difference is the one reading the code.
 *
 * Two sections, because there are two different questions and conflating them
 * serves neither:
 *
 * - **{@link storage} — is it working?** Local versus remote, side by side,
 *   with the drift between them named. This is diagnostics in the ordinary
 *   sense: something to look at when you suspect a problem.
 * - **{@link usage} — is it worth it?** What the subscription has actually
 *   done. A renewal decision turns on this and on nothing in the section above.
 *
 * ## Why nothing here writes
 *
 * Reading diagnostics must never change what it reports. `inspect()` on the
 * adoption runner adopts whatever it can settle, which would make opening this
 * panel a mutation — and one that silently resolves the very difference the
 * user opened the panel to look at. So this uses the read-only halves: the
 * manifest, `localCount()`, and each collection's loaded count. Acting on a
 * difference is a separate, deliberate button.
 */

import { computed, inject, Injectable, signal } from '@angular/core';
import { exportPortableConfig, portableKeys } from '../../portable-config';
import { CollectionAdoptionRunner, type AdoptableCollection } from './collection-adoption-runner';
import { ProfileClient, type ProfileManifest } from './profile-client';
import { ProfileFeeds } from './profile-feeds';
import { ProfileLists } from './profile-lists';
import { ProfileSync } from './profile-sync';
import { ProfileTrust } from './profile-trust';

/** One collection, both sides. */
export interface CollectionRow {
  collection: AdoptableCollection;
  label: string;
  local: number;
  /** Null when the account's copy could not be read. */
  remote: number | null;
}

/** The settings document, both sides. */
export interface SettingsRow {
  /** Keys this browser would upload, and their size. */
  localKeys: number;
  localBytes: number;
  /** What the account holds, or null when nothing is stored. */
  remoteBytes: number | null;
  remoteRevision: number | null;
  remoteUpdatedAt: string | null;
  /** True when this browser has changes it has not pushed. */
  dirty: boolean;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

const COLLECTION_LABELS: Record<AdoptableCollection, string> = {
  trust: 'Trusted accounts',
  feeds: 'RSS subscriptions',
  lists: 'Client lists',
};

@Injectable({ providedIn: 'root' })
export class PlusDiagnostics {
  private client = inject(ProfileClient);
  private sync = inject(ProfileSync);
  private adoption = inject(CollectionAdoptionRunner);
  private profileTrust = inject(ProfileTrust);
  private profileFeeds = inject(ProfileFeeds);
  private profileLists = inject(ProfileLists);

  readonly state = signal<LoadState>('idle');
  readonly error = signal<string | null>(null);

  private manifest = signal<ProfileManifest | null>(null);
  private collections = signal<CollectionRow[]>([]);

  /** The settings document, local against remote. */
  readonly settings = computed<SettingsRow>(() => {
    // The same export the pusher would send, so the local figure is what would
    // actually go up rather than a count of everything in localStorage.
    const local = exportPortableConfig(localStorage, true);
    const localBytes = new Blob([JSON.stringify(local)]).size;
    const stored = this.manifest()?.settings;
    return {
      localKeys: Object.keys(local.values ?? {}).length,
      localBytes,
      remoteBytes: stored?.size ?? null,
      remoteRevision: stored?.revision ?? null,
      remoteUpdatedAt: stored?.updatedAt ?? null,
      dirty: this.sync.record().dirty === true,
    };
  });

  readonly collectionRows = computed(() => this.collections());

  /** How many keys this browser considers portable at all. */
  readonly portableKeyCount = computed(() => portableKeys('private').length);

  readonly quota = computed(() => this.manifest()?.quota ?? null);
  readonly conflicts = computed(() => this.manifest()?.conflicts ?? null);

  /**
   * Whether anything looks out of step, so the UI can offer to fix it.
   *
   * Deliberately conservative about what counts as drift. An unpushed local
   * change is drift; a collection whose remote copy could not be read is
   * **not**, because a failed read is a fact about the network rather than
   * about the data, and offering to "fix" it would push over a copy nobody has
   * seen.
   */
  readonly drifted = computed(() => {
    if (this.settings().dirty) {
      return true;
    }
    if (this.settings().remoteBytes === null && this.settings().localKeys > 0) {
      // Nothing stored at all while this browser has settings to store.
      return true;
    }
    return this.collections().some((row) => row.remote !== null && row.remote !== row.local);
  });

  /**
   * Read everything, changing nothing.
   *
   * One manifest request plus one read per collection. Called when the panel is
   * opened rather than on a timer: this is a page someone visits when they are
   * suspicious, and polling it would add background requests to answer a
   * question nobody is asking most of the time.
   */
  async load(): Promise<void> {
    this.state.set('loading');
    this.error.set(null);

    const manifest = await this.client.manifest();
    if (manifest.kind === 'ok') {
      this.manifest.set(manifest.value);
    } else if (manifest.kind === 'absent') {
      // Nothing stored yet is a legitimate answer, not a failure.
      this.manifest.set(null);
    } else {
      this.manifest.set(null);
      this.error.set(describe(manifest));
      this.state.set('failed');
      return;
    }

    const rows: CollectionRow[] = [];
    for (const collection of ['trust', 'feeds', 'lists'] as AdoptableCollection[]) {
      const remote = this.remoteFor(collection);
      await remote.load();
      rows.push({
        collection,
        label: COLLECTION_LABELS[collection],
        local: this.adoption.localCount(collection),
        // Null rather than zero on a failed read. Zero would read as "the
        // account holds nothing", which is a different and much more alarming
        // claim than "this could not be checked".
        remote: remote.error() ? null : remote.count(),
      });
    }
    this.collections.set(rows);
    this.state.set('ready');
  }

  private remoteFor(collection: AdoptableCollection) {
    switch (collection) {
      case 'trust':
        return this.profileTrust;
      case 'feeds':
        return this.profileFeeds;
      case 'lists':
        return this.profileLists;
    }
  }
}

function describe(result: { kind: string; message?: string }): string {
  return result.message ?? 'The account could not be reached.';
}
