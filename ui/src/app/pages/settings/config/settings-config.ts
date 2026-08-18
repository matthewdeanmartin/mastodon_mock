import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfigSync, ConfigSyncFrequency, RemoteConfigResult } from '../../../config-sync';
import { PasteHistory } from '../../../providers/paste/paste-history';
import { ProfileSync } from '../../../providers/account/profile-sync';
import { SupporterStatus } from '../../../providers/account/supporter-status';
import {
  configChanges,
  ConfigChange,
  exportPortableConfig,
  importPortableConfig,
  parsePortableConfig,
  PortableConfig,
} from '../../../portable-config';

@Component({
  selector: 'app-settings-config',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-config.html',
  styleUrl: './settings-config.css',
})
export class SettingsConfig {
  protected readonly sync = inject(ConfigSync);
  private readonly pasteHistory = inject(PasteHistory);

  /**
   * Mawkingbird Plus settings sync.
   *
   * Sits alongside the URL-based `ConfigSync` above rather than replacing it.
   * The two answer different needs and both are legitimate: a published URL is
   * how you hand your setup to somebody else or keep a fleet of machines on one
   * config you edit by hand, while this is your own account following you
   * between your own browsers. Someone can reasonably use either, or neither.
   */
  protected readonly profile = inject(ProfileSync);
  private readonly supporter = inject(SupporterStatus);

  /** The upload preview shown before enabling sync for the first time. */
  protected readonly syncPreview = signal<ConfigChange[] | null>(null);
  /** A remote document waiting on a keep-mine-or-take-theirs decision. */
  protected readonly syncDecision = signal<{
    remote: PortableConfig;
    changes: ConfigChange[];
    etag: string;
    revision: number;
  } | null>(null);
  protected readonly syncMessage = signal('');

  /** Whether to offer turning sync on. Entitlement is read, never assumed. */
  protected readonly offersSync = computed(() =>
    this.profile.offersSync(this.supporter.isSupporter()),
  );
  protected readonly offersRemote = computed(() => this.profile.offersRemote());

  /**
   * A human sentence for the sync state.
   *
   * Deliberately says *when*, not just *whether*. "On" with no timestamp is the
   * shape of a feature that silently stopped working three weeks ago.
   */
  protected syncSummaryLine(): string {
    const record = this.profile.record();
    if (record.state !== 'on') {
      return 'Not syncing on this browser.';
    }
    const at = record.lastSyncedAt;
    if (at === undefined) {
      return 'Syncing — nothing saved yet.';
    }
    return `Syncing — last saved ${new Date(at).toLocaleString()}.`;
  }

  protected readonly includePrivate = signal(false);
  protected readonly importText = signal('');
  protected readonly remoteUrl = signal(this.sync.settings()?.url ?? '');
  protected readonly frequency = signal<ConfigSyncFrequency>(
    this.sync.settings()?.frequency ?? 'manual',
  );
  protected readonly preview = signal<PortableConfig | null>(null);
  protected readonly changes = signal<ConfigChange[]>([]);
  protected readonly remoteResult = signal<RemoteConfigResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected readonly publishedUrl = signal('');
  protected readonly exportPreview = signal('');
  protected readonly publishPrepared = signal(false);
  protected readonly exportMessage = signal('');

  protected exportText(): string {
    return JSON.stringify(exportPortableConfig(localStorage, this.includePrivate()), null, 2);
  }

  protected download(): void {
    this.clearNotice();
    try {
      const blob = new Blob([this.exportText()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mockingbird-config-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.exportMessage.set('Configuration downloaded.');
    } catch (error: unknown) {
      this.showError(error);
    }
  }

  protected async copy(): Promise<void> {
    this.clearNotice();
    try {
      await navigator.clipboard.writeText(this.exportText());
      this.exportMessage.set('Configuration copied to the clipboard.');
    } catch (error: unknown) {
      this.showError(error);
    }
  }

  protected previewExport(forPublish = false): void {
    this.clearNotice();
    this.exportPreview.set(this.exportText());
    this.publishPrepared.set(forPublish);
    this.exportMessage.set(
      forPublish
        ? 'Review this exact JSON before creating the paste.'
        : 'Export preview generated. Nothing was downloaded, copied, or published.',
    );
  }

  protected closeExportPreview(): void {
    this.exportPreview.set('');
    this.publishPrepared.set(false);
  }

  protected async publish(): Promise<void> {
    const content = this.exportPreview();
    if (!this.publishPrepared() || !content) {
      this.previewExport(true);
      return;
    }
    this.clearNotice();
    this.busy.set(true);
    try {
      const created = await this.sync.publishPermanent(content);
      this.pasteHistory.add(
        'pastepile',
        'Pastepile',
        {
          title: 'Mockingbird client configuration',
          content,
          language: 'json',
          expiry: 'never',
          visibility: 'unlisted',
        },
        created,
      );
      this.publishedUrl.set(created.url);
      this.remoteUrl.set(created.rawUrl);
      this.exportMessage.set('Published and saved in My Pastes with its edit password.');
      const result = await this.sync.fetchStable(created.rawUrl);
      this.remoteResult.set(result);
      this.previewConfig(result.config);
      this.message.set('Permanent unlisted Pastepile created and verified.');
      this.publishPrepared.set(false);
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected previewPasted(): void {
    this.clearNotice();
    this.remoteResult.set(null);
    try {
      this.previewConfig(parsePortableConfig(this.importText()));
    } catch (error: unknown) {
      this.preview.set(null);
      this.changes.set([]);
      this.showError(error);
    }
  }

  protected async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    this.importText.set(await file.text());
    this.previewPasted();
  }

  protected async loadUrl(): Promise<void> {
    this.clearNotice();
    this.busy.set(true);
    try {
      const result = await this.sync.fetchStable(this.remoteUrl().trim());
      this.remoteResult.set(result);
      this.previewConfig(result.config);
      this.message.set(result.warning ?? 'Remote configuration fetched twice and verified stable.');
    } catch (error: unknown) {
      this.remoteResult.set(null);
      this.preview.set(null);
      this.changes.set([]);
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected apply(): void {
    const config = this.preview();
    if (!config) {
      return;
    }
    const count = this.changes().length;
    if (
      !confirm(
        `Import this configuration and reload? ${count} setting${count === 1 ? '' : 's'} will change. Missing settings covered by the file are reset.`,
      )
    ) {
      return;
    }
    importPortableConfig(config, localStorage);
    const remote = this.remoteResult();
    if (remote && this.remoteUrl().trim()) {
      this.sync.configure(this.remoteUrl().trim(), this.frequency(), remote);
    }
    location.reload();
  }

  protected saveSource(): void {
    const result = this.remoteResult();
    const url = this.remoteUrl().trim();
    if (!result || !url) {
      return;
    }
    this.sync.configure(url, this.frequency(), result);
    const saved = this.sync.settings();
    this.frequency.set(saved?.frequency ?? 'manual');
    this.message.set(
      result.stable
        ? 'Remote source saved.'
        : 'Source saved for on-demand checks only because it could not be verified as stable.',
    );
  }

  protected clearSource(): void {
    this.sync.clear();
    this.remoteUrl.set('');
    this.remoteResult.set(null);
    this.frequency.set('manual');
    this.message.set('Remote source removed.');
  }

  protected syncSummary(): string {
    const saved = this.sync.settings();
    if (!saved) {
      return 'No remote source saved.';
    }
    const checked = saved.lastCheckedAt ? new Date(saved.lastCheckedAt).toLocaleString() : 'never';
    return `${saved.frequency === 'manual' ? 'On demand' : saved.frequency} · last checked ${checked}`;
  }

  // --- Mawkingbird Plus settings sync -------------------------------------

  /**
   * Show what turning sync on would upload, before it uploads anything.
   *
   * Worth a click of its own because the first push defines the baseline every
   * other browser inherits. "Show me first" costs nothing here — the diff is
   * the same `configChanges()` the import preview already uses.
   */
  protected previewSyncUpload(): void {
    this.clearNotice();
    const upload = this.profile.previewUpload();
    // Against an empty store, so this reads as "what would be uploaded" rather
    // than "what would change", which is the question being asked.
    this.syncPreview.set(
      Object.keys(upload.values).map((key) => ({ key, action: 'add' as const })),
    );
  }

  protected cancelSyncPreview(): void {
    this.syncPreview.set(null);
  }

  protected async enableSync(): Promise<void> {
    this.clearNotice();
    this.syncPreview.set(null);
    const ok = await this.profile.enable();
    this.syncMessage.set(
      ok
        ? 'Settings sync is on. Your other browsers will pick these up next time you use them.'
        : 'Could not save your settings just now. Sync stays on and will retry.',
    );
  }

  /** Decline permanently. The offer does not return. */
  protected declineSync(): void {
    this.clearNotice();
    this.profile.decline();
    this.syncMessage.set('Settings stay on this browser only.');
  }

  protected disableSync(): void {
    this.clearNotice();
    this.profile.disable();
    // Says explicitly that nothing was deleted. An off switch people are afraid
    // of is an off switch that does not get used.
    this.syncMessage.set(
      'Stopped syncing on this browser. Nothing was deleted — your stored settings are still there.',
    );
  }

  /** Adopt settings this account already has stored from another browser. */
  protected async adoptRemote(): Promise<void> {
    this.clearNotice();
    const outcome = await this.profile.adoptRemote();
    if (outcome.kind === 'applied') {
      this.syncMessage.set(`Applied ${outcome.changes.length} setting(s). Reloading…`);
      location.reload();
      return;
    }
    if (outcome.kind === 'needs-decision') {
      this.syncDecision.set({
        remote: outcome.remote,
        changes: outcome.changes,
        etag: outcome.etag,
        revision: outcome.revision,
      });
      return;
    }
    this.syncMessage.set(
      outcome.kind === 'failed' ? outcome.message : 'Nothing stored for this account yet.',
    );
  }

  /** Pull now, surfacing a decision if this browser has unsaved edits. */
  protected async syncNow(): Promise<void> {
    this.clearNotice();
    const outcome = await this.profile.pull();
    switch (outcome.kind) {
      case 'applied':
        this.syncMessage.set(`Applied ${outcome.changes.length} setting(s). Reloading…`);
        location.reload();
        return;
      case 'needs-decision':
        this.syncDecision.set({
          remote: outcome.remote,
          changes: outcome.changes,
          etag: outcome.etag,
          revision: outcome.revision,
        });
        return;
      case 'unchanged':
        // Push anyway: unchanged means the *remote* has not moved, which says
        // nothing about whether this browser has edits waiting.
        await this.profile.push();
        this.syncMessage.set('Already up to date.');
        return;
      case 'absent':
        await this.profile.push();
        this.syncMessage.set('Saved this browser’s settings.');
        return;
      case 'failed':
        this.syncMessage.set(outcome.message);
        return;
    }
  }

  /** Resolve a decision by taking the other browser's copy. */
  protected useRemote(): void {
    const decision = this.syncDecision();
    if (!decision) {
      return;
    }
    this.profile.useRemote(decision.remote, decision.etag, decision.revision);
    this.syncDecision.set(null);
    location.reload();
  }

  /** Resolve a decision by keeping this browser's copy and pushing it. */
  protected async keepLocal(): Promise<void> {
    const decision = this.syncDecision();
    if (!decision) {
      return;
    }
    const ok = await this.profile.keepLocal(decision.etag, decision.revision);
    this.syncDecision.set(null);
    this.syncMessage.set(
      ok
        ? 'Kept this browser’s settings and saved them to your account.'
        : 'Could not save just now. This browser’s settings are unchanged and will retry.',
    );
  }

  protected dismissDecision(): void {
    this.syncDecision.set(null);
  }

  private previewConfig(config: PortableConfig): void {
    this.preview.set(config);
    this.changes.set(configChanges(config, localStorage));
  }

  private clearNotice(): void {
    this.error.set('');
    this.message.set('');
    this.exportMessage.set('');
  }

  private showError(error: unknown): void {
    this.error.set(error instanceof Error ? error.message : 'Configuration operation failed.');
  }
}
