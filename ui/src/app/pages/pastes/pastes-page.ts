import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HumanTimePipe } from '../../human-time.pipe';
import { PasteFeedSubscriptions } from '../../providers/paste/paste-feed-subscriptions';
import { PasteHistory, PasteRecord } from '../../providers/paste/paste-history';
import { FeedPasteProvider } from '../../providers/paste/paste-provider';
import { PasteProviderRegistry } from '../../providers/paste/paste-provider-registry';

@Component({
  selector: 'app-pastes-page',
  imports: [FormsModule, HumanTimePipe],
  templateUrl: './pastes-page.html',
  styleUrl: './pastes-page.css',
})
export class PastesPage {
  protected history = inject(PasteHistory);
  protected providers = inject(PasteProviderRegistry);
  private feeds = inject(PasteFeedSubscriptions);

  protected editing = signal<string | null>(null);
  protected editTitle = signal('');
  protected editContent = signal('');
  protected editLanguage = signal('plaintext');
  protected busy = signal<string | null>(null);
  protected error = signal<string | null>(null);

  isFollowing(provider: FeedPasteProvider): boolean {
    return this.feeds.has(provider.id);
  }

  toggleFeed(provider: FeedPasteProvider): void {
    if (this.isFollowing(provider)) {
      this.feeds.unfollow(provider.id);
    } else {
      this.feeds.follow(provider.id, provider.feedUrl, `${provider.label} public pastes`);
    }
  }

  beginEdit(record: PasteRecord): void {
    this.editing.set(record.slug);
    this.editTitle.set(record.title);
    this.editContent.set(record.content);
    this.editLanguage.set(record.language);
    this.error.set(null);
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.error.set(null);
  }

  save(record: PasteRecord): void {
    const provider = this.providers.get(record.providerId);
    if (!provider || !this.editContent().trim()) {
      return;
    }
    this.busy.set(record.slug);
    this.error.set(null);
    provider
      .update(record.slug, record.editKey, {
        title: this.editTitle().trim(),
        content: this.editContent(),
        language: this.editLanguage(),
      })
      .subscribe({
        next: () => {
          this.history.update(record.slug, {
            title: this.editTitle().trim(),
            content: this.editContent(),
            language: this.editLanguage(),
          });
          this.busy.set(null);
          this.editing.set(null);
        },
        error: () => {
          this.busy.set(null);
          this.error.set('The paste could not be updated. It may have expired.');
        },
      });
  }

  delete(record: PasteRecord): void {
    if (!confirm('Delete this paste from the provider? This cannot be undone.')) {
      return;
    }
    const provider = this.providers.get(record.providerId);
    if (!provider) {
      this.history.remove(record.slug);
      return;
    }
    this.busy.set(record.slug);
    this.error.set(null);
    provider.delete(record.slug, record.editKey).subscribe({
      next: () => {
        this.history.remove(record.slug);
        this.busy.set(null);
      },
      error: () => {
        this.busy.set(null);
        this.error.set('The provider could not delete that paste. It may already have expired.');
      },
    });
  }

  forget(record: PasteRecord): void {
    this.history.remove(record.slug);
    if (this.editing() === record.slug) {
      this.cancelEdit();
    }
  }
}
