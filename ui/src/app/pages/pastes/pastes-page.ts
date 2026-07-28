import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ClientPrefs } from '../../client-prefs';
import { Compose } from '../../compose/compose';
import { Drafts } from '../../drafts';
import { HumanTimePipe } from '../../human-time.pipe';
import { toSnapshot } from '../drafts/draft-items';
import { PasteFeedSubscriptions } from '../../providers/paste/paste-feed-subscriptions';
import { PasteHistory, PasteRecord } from '../../providers/paste/paste-history';
import { FeedPasteProvider } from '../../providers/paste/paste-provider';
import { PasteProviderRegistry } from '../../providers/paste/paste-provider-registry';

/** Which top-level section is showing. "My Pastes" is the default landing tab. */
type PasteTab = 'mine' | 'feeds';

@Component({
  selector: 'app-pastes-page',
  imports: [FormsModule, RouterLink, HumanTimePipe, Compose],
  templateUrl: './pastes-page.html',
  styleUrl: './pastes-page.css',
})
export class PastesPage {
  protected history = inject(PasteHistory);
  protected providers = inject(PasteProviderRegistry);
  private feeds = inject(PasteFeedSubscriptions);
  private drafts = inject(Drafts);
  private prefs = inject(ClientPrefs);
  private router = inject(Router);

  /** Transient "that worked, and your paste survived" confirmation. */
  protected notice = signal<string | null>(null);

  /** Active tab; mirrors the Lists page split (My Pastes | Public Paste Feeds). */
  protected tab = signal<PasteTab>('mine');

  protected editing = signal<string | null>(null);
  protected editTitle = signal('');
  protected editContent = signal('');
  protected editLanguage = signal('plaintext');
  protected busy = signal<string | null>(null);
  protected error = signal<string | null>(null);

  /**
   * The paste whose "Paste and Share" composer is open, or null. The paste
   * already exists at its provider; sharing just posts a link to it on the
   * socials (Mastodon/Bsky), so the composer is seeded with the title + URL and
   * lets the target picker choose where the link goes. One open at a time.
   */
  protected sharing = signal<string | null>(null);

  selectTab(tab: PasteTab): void {
    this.tab.set(tab);
  }

  /** Open the share composer for a paste (closing any other), or toggle it shut. */
  toggleShare(record: PasteRecord): void {
    this.sharing.set(this.sharing() === record.slug ? null : record.slug);
  }

  /** Seed text for the share post: the title (if any) followed by the paste URL. */
  shareText(record: PasteRecord): string {
    const title = record.title?.trim();
    return title ? `${title}\n\n${record.url}` : record.url;
  }

  /** Once the share post is published, collapse the composer. */
  onShared(): void {
    this.sharing.set(null);
  }

  isFollowing(provider: FeedPasteProvider): boolean {
    return this.feeds.has(provider.id);
  }

  /** TinyURL links can't be edited or deleted after creation. */
  isImmutable(providerId: string): boolean {
    return !!this.providers.get(providerId)?.immutable;
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
      .update(record.slug, this.history.editKeyFor(record.slug), {
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
    provider.delete(record.slug, this.history.editKeyFor(record.slug)).subscribe({
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

  /**
   * Copy a paste into a browser-local draft. The paste is deliberately left at
   * its provider — converting must never be how you lose the thing you
   * converted. Same rule, and same `toSnapshot`, as the /drafts page.
   */
  convertToDraft(record: PasteRecord): void {
    this.drafts.save(toSnapshot({ kind: 'paste', record }, this.prefs.defaultVisibility()));
    this.notice.set('Copied to your local drafts. This paste is still here too.');
  }

  /** Load the paste into the composer with a live Post button, leaving it in place. */
  editForPost(record: PasteRecord): void {
    this.drafts.handoff(toSnapshot({ kind: 'paste', record }, this.prefs.defaultVisibility()));
    void this.router.navigate(['/home']);
  }

  forget(record: PasteRecord): void {
    this.history.remove(record.slug);
    if (this.editing() === record.slug) {
      this.cancelEdit();
    }
  }
}
