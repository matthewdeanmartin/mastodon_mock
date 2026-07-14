import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { PostDeletionSettings } from '../../../models';

/** Automatic post deletion policy (mock-only settings section). */
@Component({
  selector: 'app-settings-deletion',
  imports: [FormsModule],
  templateUrl: './settings-deletion.html',
})
export class SettingsDeletion implements OnInit {
  private api = inject(Api);

  protected enabled = signal(false);
  protected minAgeDays = signal(30);
  protected keepPinned = signal(true);
  protected keepFavourited = signal(false);
  protected keepMedia = signal(false);
  protected keepPolls = signal(false);
  protected minFavourites = signal(0);
  protected minReblogs = signal(0);
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    this.api.mockSettings().subscribe((settings) => {
      const d = settings.post_deletion;
      this.enabled.set(d.enabled);
      this.minAgeDays.set(d.min_age_days);
      this.keepPinned.set(d.keep_pinned);
      this.keepFavourited.set(d.keep_favourited);
      this.keepMedia.set(d.keep_media);
      this.keepPolls.set(d.keep_polls);
      this.minFavourites.set(d.min_favourites);
      this.minReblogs.set(d.min_reblogs);
    });
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);

    const postDeletion: PostDeletionSettings = {
      enabled: this.enabled(),
      min_age_days: Number(this.minAgeDays()),
      keep_pinned: this.keepPinned(),
      keep_favourited: this.keepFavourited(),
      keep_media: this.keepMedia(),
      keep_polls: this.keepPolls(),
      min_favourites: Number(this.minFavourites()),
      min_reblogs: Number(this.minReblogs()),
    };

    this.api.updateMockSettings({ post_deletion: postDeletion }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
      },
      error: () => this.saving.set(false),
    });
  }
}
