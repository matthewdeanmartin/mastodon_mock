import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { ClientPrefs, ACCENT_PRESETS } from '../../../client-prefs';
import { AppearanceSettings } from '../../../models';
import { Server } from '../../../server';

/**
 * Appearance: theme, accent color and posting safeguards apply instantly and live in
 * localStorage (they work against any instance, including mastodon.social). Media,
 * motion and spoiler preferences are stored on the mock server and only shown there.
 */
@Component({
  selector: 'app-settings-appearance',
  imports: [FormsModule],
  templateUrl: './settings-appearance.html',
})
export class SettingsAppearance implements OnInit {
  private api = inject(Api);
  private server = inject(Server);

  protected readonly prefs = inject(ClientPrefs);
  protected readonly accents = ACCENT_PRESETS;

  /** Whether the server-backed preference rows apply (mock instance only). */
  protected readonly isMock = this.server.isMock;

  protected displayMedia = signal<AppearanceSettings['display_media']>('default');
  protected reduceMotion = signal(false);
  protected disableSwiping = signal(false);
  protected expandSpoilers = signal(false);
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    if (!this.isMock) {
      return;
    }
    this.api.mockSettings().subscribe((settings) => {
      const a = settings.appearance;
      this.displayMedia.set(a.display_media);
      this.reduceMotion.set(a.reduce_motion);
      this.disableSwiping.set(a.disable_swiping);
      this.expandSpoilers.set(a.expand_spoilers);
    });
  }

  protected save(): void {
    if (this.saving() || !this.isMock) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);

    const appearance: AppearanceSettings = {
      theme: this.prefs.themeMode(),
      display_media: this.displayMedia(),
      reduce_motion: this.reduceMotion(),
      disable_swiping: this.disableSwiping(),
      expand_spoilers: this.expandSpoilers(),
    };

    this.api.updateMockSettings({ appearance }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
      },
      error: () => this.saving.set(false),
    });
  }
}
