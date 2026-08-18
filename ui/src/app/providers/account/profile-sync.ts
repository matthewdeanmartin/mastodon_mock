import { computed, inject, Injectable, signal } from '@angular/core';
import {
  configChanges,
  exportPortableConfig,
  importPortableConfig,
  portableKeys,
  type ConfigChange,
  type PortableConfig,
} from '../../portable-config';
import { ProfileClient, type SettingsDocument } from './profile-client';
import {
  FAILURES_BEFORE_WARNING,
  isSyncing,
  readSyncRecord,
  shouldOfferRemote,
  shouldOfferSync,
  updateSyncRecord,
  writeSyncRecord,
  type ProfileSyncRecord,
} from './profile-sync-state';

/**
 * Settings sync.
 *
 * ## Scope
 *
 * The settings document only. Provider collections are server-side with no
 * local copy, so there is nothing to reconcile there — see
 * `mawkingbird_profile/docs/02-sync.md`. That narrowing is what keeps this
 * module small enough to reason about.
 *
 * ## The arbiter is a revision, not a clock
 *
 * Client clocks are wrong — a VM resumed from suspend, a dead CMOS battery, a
 * phone that just crossed a timezone. A browser a few hours fast would win every
 * conflict forever, and the user would watch their other machine's edits vanish
 * with no pattern they could describe. So `revision` decides, and `updatedAt`
 * only breaks ties and gives the UI something human to show.
 *
 * ## Size is not a tiebreaker
 *
 * Worth stating because "newest or largest wins" is the intuitive rule and the
 * second half of it destroys data. Every deliberate act of tidying makes a
 * document *smaller*: turning off feature flags, resetting typography,
 * clearing a customised prompt. Under largest-wins each of those is silently
 * reverted by whichever browser still holds the older, fuller copy — the user's
 * most considered action losing to their most neglected browser. Newest-wins
 * gets these right, because the deletion *is* the newest edit.
 *
 * ## Failure posture
 *
 * Failures degrade; they never break the app. The app worked signed out before
 * this feature existed and must still. A pull failure leaves localStorage alone;
 * a push failure keeps the dirty flag and retries later.
 */

/** A writer id for this browser. Random, not a fingerprint. */
const WRITER_KEY = 'mockingbird_profile_writer';

/** Debounce before pushing a local change, in milliseconds. */
export const PUSH_DEBOUNCE_MS = 10_000;

/** Re-check the manifest when a tab regains focus after this long. */
export const FOCUS_RECHECK_MS = 5 * 60 * 1000;

export const SETTINGS_KIND = 'mawkingbird-profile-settings';
export const SETTINGS_SCHEMA_VERSION = 1;

/** What a pull decided, so the UI can say what happened. */
export type PullOutcome =
  /** Nothing stored remotely. */
  | { kind: 'absent' }
  /** Remote matched what we already had. */
  | { kind: 'unchanged' }
  /** Remote was ahead and clean locally: applied silently. */
  | { kind: 'applied'; changes: ConfigChange[] }
  /**
   * Remote is ahead AND this browser has unpushed edits. The one case that
   * must ask, because either answer loses something.
   */
  /**
   * `revision` is the *remote* revision, and it is load-bearing: whichever way
   * the user decides, the next write has to advance past it or the service
   * answers 409. Carrying it here rather than re-reading it later is what keeps
   * "keep mine" from needing a second round trip to become legal.
   */
  | {
      kind: 'needs-decision';
      remote: PortableConfig;
      changes: ConfigChange[];
      etag: string;
      revision: number;
    }
  | { kind: 'failed'; message: string };

@Injectable({ providedIn: 'root' })
export class ProfileSync {
  private client = inject(ProfileClient);

  /** This browser's view of the account-level switch. */
  readonly record = signal<ProfileSyncRecord>(readSyncRecord());

  /** True while a push or pull is in flight. */
  readonly busy = signal(false);

  /** The last failure worth showing, or null. */
  readonly error = signal<string | null>(null);

  /** True when the subscription lapsed: reads work, writes do not. */
  readonly readOnly = signal(false);

  readonly syncing = computed(() => isSyncing(this.record()));
  readonly lastSyncedAt = computed(() => this.record().lastSyncedAt ?? null);

  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastManifestAt = 0;

  /** Whether to show the first-enable prompt. */
  offersSync(entitled: boolean): boolean {
    return shouldOfferSync(this.record(), entitled);
  }

  /** Whether to show the "settings exist from another browser" offer. */
  offersRemote(): boolean {
    return shouldOfferRemote(this.record());
  }

  /**
   * Turn sync on, uploading this browser's settings as the baseline.
   *
   * The upload is the whole reason this is a deliberate action: the first push
   * defines what every other machine will inherit. The UI must say so before
   * calling this.
   */
  async enable(): Promise<boolean> {
    this.setRecord(updateSyncRecord({ state: 'on', dirty: true }));
    const pushed = await this.push();
    if (!pushed) {
      // Left `on` with the dirty flag set, so the next trigger retries. Turning
      // it back off would discard an explicit decision because of a transient
      // network failure.
      return false;
    }
    return true;
  }

  /**
   * Decline sync. Permanent — the prompt never returns.
   *
   * From `off-but-remote-exists` this means "not on this browser", which is the
   * same stored state: a decision not to participate here.
   */
  decline(): void {
    this.setRecord(updateSyncRecord({ state: 'off' }));
  }

  /**
   * Stop syncing, keeping everything as it stands.
   *
   * Does **not** delete the stored document. Someone turning sync off is saying
   * "stop changing my browser", not "destroy my profile", and conflating those
   * would make the off switch frightening to use.
   */
  disable(): void {
    this.cancelPush();
    this.setRecord(updateSyncRecord({ state: 'off', dirty: false }));
  }

  /**
   * Adopt the settings already stored for this account.
   *
   * The `off-but-remote-exists` answer. Pulls, applies, and turns sync on.
   */
  async adoptRemote(): Promise<PullOutcome> {
    this.setRecord(updateSyncRecord({ state: 'on', dirty: false }));
    return this.pull();
  }

  /**
   * Settle sync state on startup.
   *
   * Cheap: one manifest call. Detects `off-but-remote-exists`, notices a lapsed
   * subscription, and pulls only when there is something to pull.
   */
  async start(): Promise<void> {
    const manifest = await this.client.manifest();
    this.lastManifestAt = Date.now();

    if (manifest.kind === 'payment-required') {
      this.readOnly.set(true);
      return;
    }
    if (manifest.kind !== 'ok') {
      // Signed out or unreachable. Neither is an error worth showing: the app
      // works without this service.
      return;
    }

    this.readOnly.set(manifest.value.readOnly);
    const current = this.record();

    // Locally never asked, remotely present: they enabled sync somewhere else.
    if (current.state === 'unasked' && manifest.value.settings) {
      this.setRecord(updateSyncRecord({ state: 'off-but-remote-exists' }));
      return;
    }

    if (!isSyncing(current)) {
      return;
    }

    // Only fetch when the remote is actually ahead. A revision comparison costs
    // nothing and saves a round trip on every start where nothing changed.
    const remoteRevision = manifest.value.settings?.revision;
    if (remoteRevision !== undefined && remoteRevision > (current.revision ?? -1)) {
      await this.pull();
    }
  }

  /**
   * Re-check when a tab regains focus, if it has been a while.
   *
   * Cheap by construction: the manifest is small, and a 304 on the document
   * itself costs almost nothing. This is what catches the other-machine case
   * without polling.
   */
  async recheckOnFocus(): Promise<void> {
    if (!this.syncing() || Date.now() - this.lastManifestAt < FOCUS_RECHECK_MS) {
      return;
    }
    await this.start();
  }

  /**
   * Note that a synced setting changed locally.
   *
   * Sets the dirty flag immediately and schedules a debounced push. The flag
   * matters more than the timer: it is what makes a later pull ask rather than
   * silently overwrite.
   */
  noteLocalChange(): void {
    if (!this.syncing()) {
      return;
    }
    this.setRecord(updateSyncRecord({ dirty: true }));
    this.schedulePush();
  }

  /**
   * Pull the stored document and decide what to do with it.
   *
   * The decision table, and the reasoning for each row:
   *
   * - **Not dirty, remote ahead** → apply silently. This is the overwhelmingly
   *   common path and prompting here would train people to click through.
   * - **Dirty, remote ahead** → ask. Either answer loses something, so it is
   *   not ours to choose.
   * - **Unchanged or absent** → nothing to do.
   */
  async pull(): Promise<PullOutcome> {
    const current = this.record();
    this.busy.set(true);
    try {
      const fetched = await this.client.fetchSettings(current.etag);

      if (fetched.kind === 'unchanged') {
        return { kind: 'unchanged' };
      }
      if (fetched.kind === 'absent') {
        return { kind: 'absent' };
      }
      if (fetched.kind === 'payment-required') {
        this.readOnly.set(true);
        return { kind: 'failed', message: fetched.message };
      }
      if (fetched.kind !== 'ok') {
        const message = 'message' in fetched ? fetched.message : 'Could not read your profile.';
        return { kind: 'failed', message };
      }

      const { document, etag } = fetched.value;
      const remote = this.toPortableConfig(document);
      const changes = configChanges(remote, localStorage);

      if (current.dirty) {
        // The one case that must ask. Deliberately does not apply anything
        // first: the user may choose to keep this browser's copy, and a partial
        // application would have already destroyed it.
        return { kind: 'needs-decision', remote, changes, etag, revision: document.revision };
      }

      importPortableConfig(remote, localStorage);
      this.setRecord(
        updateSyncRecord({
          etag,
          revision: document.revision,
          dirty: false,
          lastSyncedAt: Date.now(),
          failures: 0,
        }),
      );
      return { kind: 'applied', changes };
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Resolve a `needs-decision` by taking the other browser's copy.
   *
   * The local copy is not preserved here — the service keeps a conflict sidecar
   * when a write loses, and this path is a *read* that never wrote. If the local
   * copy matters, {@link keepLocal} pushes it instead, and the remote becomes
   * the sidecar.
   */
  useRemote(remote: PortableConfig, etag: string, revision: number): ConfigChange[] {
    const changes = configChanges(remote, localStorage);
    importPortableConfig(remote, localStorage);
    this.setRecord(
      updateSyncRecord({ etag, revision, dirty: false, lastSyncedAt: Date.now(), failures: 0 }),
    );
    return changes;
  }

  /**
   * Resolve a `needs-decision` by keeping this browser's copy.
   *
   * Adopts the remote ETag and revision so the subsequent push is a legal update
   * rather than a doomed create — the local *content* wins, the remote
   * *position in the sequence* is respected.
   */
  async keepLocal(etag: string, remoteRevision: number): Promise<boolean> {
    this.setRecord(updateSyncRecord({ etag, revision: remoteRevision, dirty: true }));
    return this.push();
  }

  /**
   * Push this browser's settings.
   *
   * Returns false on any failure, having recorded it. Never throws into a
   * caller: a UI action must not fail because a background sync did.
   */
  async push(): Promise<boolean> {
    if (!this.syncing() || this.readOnly()) {
      return false;
    }
    this.cancelPush();
    this.busy.set(true);
    try {
      const current = this.record();
      const document = this.buildDocument((current.revision ?? 0) + 1);
      const result = await this.client.putSettings(document, current.etag);

      if (result.kind === 'ok') {
        this.setRecord(
          updateSyncRecord({
            etag: result.value.etag,
            revision: result.value.revision,
            dirty: false,
            lastSyncedAt: Date.now(),
            failures: 0,
            warning: undefined,
          }),
        );
        this.error.set(null);
        return true;
      }

      if (result.kind === 'conflict') {
        // Someone else wrote first. Adopt their ETag and revision so the retry
        // is a legal update, and keep the dirty flag: this browser's edits are
        // still unsaved. The next pull surfaces the decision.
        this.setRecord(
          updateSyncRecord({ etag: result.etag, revision: result.current.revision, dirty: true }),
        );
        return false;
      }

      if (result.kind === 'payment-required') {
        this.readOnly.set(true);
        this.error.set(result.message);
        return false;
      }

      this.noteFailure('message' in result ? result.message : 'Could not save your settings.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** Cancel a pending debounced push. */
  cancelPush(): void {
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }

  /** The diff between a remote document and this browser, for a preview. */
  changesAgainstLocal(remote: PortableConfig): ConfigChange[] {
    return configChanges(remote, localStorage);
  }

  /** What this browser would upload, for the "show me first" affordance. */
  previewUpload(): PortableConfig {
    return exportPortableConfig(localStorage, false);
  }

  private schedulePush(): void {
    this.cancelPush();
    // Debounced because Class A (write) operations are the expensive ones.
    // Toggling a setting five times should be one write, not five.
    this.pushTimer = setTimeout(() => void this.push(), PUSH_DEBOUNCE_MS);
  }

  /**
   * Build the document to upload.
   *
   * `exportPortableConfig` is the source of truth for *what* goes in — including
   * its `assertSafeConfig()` leak test, which greps the payload against the
   * credentials actually in this browser's storage. That check is the real
   * boundary; the service's own pattern matching is a backstop for a modified
   * client. Building the document any other way would skip it.
   */
  private buildDocument(revision: number): SettingsDocument {
    const config = exportPortableConfig(localStorage, false);
    return {
      kind: SETTINGS_KIND,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      minimumReaderVersion: SETTINGS_SCHEMA_VERSION,
      revision,
      updatedAt: new Date().toISOString(),
      writer: this.writerId(),
      values: config.values,
      // The exact allowlist, so the service can validate precisely. It cannot
      // derive this: distinguishing a scoped key from an underscored global one
      // needs the registry, which the service deliberately does not hold.
      keys: portableKeys('standard'),
    };
  }

  /**
   * Turn a stored document back into a portable config.
   *
   * The two formats are deliberately close but not identical: the portable one
   * carries `privacy` and `exportedAt`, the stored one carries `revision` and
   * `writer`. Converting here rather than widening either keeps
   * `portable-config.ts` unaware that a sync service exists.
   */
  private toPortableConfig(document: SettingsDocument): PortableConfig {
    return {
      kind: 'mockingbird-client-config',
      schemaVersion: 1,
      minimumReaderVersion: 1,
      exportedAt: document.updatedAt,
      privacy: 'standard',
      values: document.values,
    };
  }

  /**
   * A stable random id for this browser.
   *
   * Only so a conflict can say "your other browser" instead of "someone". Not a
   * fingerprint, and never sent anywhere except inside the user's own document.
   */
  private writerId(): string {
    try {
      const existing = localStorage.getItem(WRITER_KEY);
      if (existing) {
        return existing;
      }
      const created = `dev_${crypto.randomUUID().slice(0, 8)}`;
      localStorage.setItem(WRITER_KEY, created);
      return created;
    } catch {
      return 'dev_unknown';
    }
  }

  /**
   * Record a push failure, surfacing it only once it looks permanent.
   *
   * Silent permanent failure is how someone discovers on a new laptop that
   * nothing has synced since March. One failed push, though, is usually a tunnel
   * or a sleeping laptop and is not worth a message.
   */
  private noteFailure(message: string): void {
    const failures = (this.record().failures ?? 0) + 1;
    const patch: Partial<ProfileSyncRecord> = { failures, dirty: true };
    if (failures >= FAILURES_BEFORE_WARNING) {
      patch.warning = message;
      this.error.set(message);
    }
    this.setRecord(updateSyncRecord(patch));
  }

  private setRecord(next: ProfileSyncRecord): void {
    this.record.set(next);
  }

  /** Reset this browser's sync state. Test-only. */
  resetForTest(record: ProfileSyncRecord): void {
    writeSyncRecord(record);
    this.record.set(record);
  }
}
