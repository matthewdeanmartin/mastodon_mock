import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigSync, ConfigSyncFrequency, RemoteConfigResult } from '../../../config-sync';
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
  imports: [FormsModule],
  templateUrl: './settings-config.html',
  styleUrl: './settings-config.css',
})
export class SettingsConfig {
  protected readonly sync = inject(ConfigSync);

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
      this.message.set('Configuration downloaded.');
    } catch (error: unknown) {
      this.showError(error);
    }
  }

  protected async copy(): Promise<void> {
    this.clearNotice();
    try {
      await navigator.clipboard.writeText(this.exportText());
      this.message.set('Configuration copied to the clipboard.');
    } catch (error: unknown) {
      this.showError(error);
    }
  }

  protected async publish(): Promise<void> {
    this.clearNotice();
    this.busy.set(true);
    try {
      const created = await this.sync.publishPermanent(this.exportText());
      this.publishedUrl.set(created.url);
      this.remoteUrl.set(created.rawUrl);
      const result = await this.sync.fetchStable(created.rawUrl);
      this.remoteResult.set(result);
      this.previewConfig(result.config);
      this.message.set('Permanent unlisted Pastepile created and verified.');
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

  private previewConfig(config: PortableConfig): void {
    this.preview.set(config);
    this.changes.set(configChanges(config, localStorage));
  }

  private clearNotice(): void {
    this.error.set('');
    this.message.set('');
  }

  private showError(error: unknown): void {
    this.error.set(error instanceof Error ? error.message : 'Configuration operation failed.');
  }
}
