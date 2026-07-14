import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { AppearanceSettings } from '../../../models';

/** Appearance: theme, media display, motion and spoiler preferences. */
@Component({
  selector: 'app-settings-appearance',
  imports: [FormsModule],
  templateUrl: './settings-appearance.html',
})
export class SettingsAppearance implements OnInit {
  private api = inject(Api);

  protected theme = signal<AppearanceSettings['theme']>('auto');
  protected displayMedia = signal<AppearanceSettings['display_media']>('default');
  protected reduceMotion = signal(false);
  protected disableSwiping = signal(false);
  protected expandSpoilers = signal(false);
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    this.api.mockSettings().subscribe((settings) => {
      const a = settings.appearance;
      this.theme.set(a.theme);
      this.displayMedia.set(a.display_media);
      this.reduceMotion.set(a.reduce_motion);
      this.disableSwiping.set(a.disable_swiping);
      this.expandSpoilers.set(a.expand_spoilers);
    });
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);

    const appearance: AppearanceSettings = {
      theme: this.theme(),
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
