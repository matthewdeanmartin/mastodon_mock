import { Component, computed, inject, OnInit } from '@angular/core';
import { AlgoFeed, AlgoPost, AlgoSource } from '../../algo-feed';
import { AlgoAudience, ClientPrefs } from '../../client-prefs';
import { isHeated } from '../../sentiment';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

const SOURCE_LABELS: Record<AlgoSource, string> = {
  mutual: 'Top post from a mutual',
  boost: 'Boosted into your feed',
  original: 'Top post from your feed',
  hashtag: 'From a hashtag you follow',
};

/** Friends means posts *authored* by follows — boosts and hashtag finds are not it. */
const FRIEND_SOURCES: readonly AlgoSource[] = ['mutual', 'original'];

/**
 * ✨ Algo — the consumer-centric algorithmic feed. Content the user already
 * asked for, ranked by engagement, with client-side audience, tags, and
 * calm-mode filters. The expensive build lives in {@link AlgoFeed}; this page
 * renders the cached result and offers the explicit refresh and shuffle.
 */
@Component({
  selector: 'app-algo',
  imports: [StatusCard],
  templateUrl: './algo.html',
  styleUrl: './algo.css',
})
export class Algo implements OnInit {
  protected feed = inject(AlgoFeed);
  protected prefs = inject(ClientPrefs);

  /** Whether a post survives the audience + tags chips (calm applied separately). */
  private passesChips(p: AlgoPost): boolean {
    if (this.prefs.algoAudience() === 'friends') {
      return FRIEND_SOURCES.includes(p.source);
    }
    return p.source !== 'hashtag' || this.prefs.algoTags();
  }

  /** The cached feed with the audience, tags, and calm filters applied. */
  protected visible = computed(() =>
    this.feed
      .posts()
      .filter((p) => this.passesChips(p) && !(this.prefs.algoCalm() && isHeated(p.status))),
  );

  /** How many posts calm mode is currently hiding, for the chip hint. */
  protected calmHidden = computed(() => {
    if (!this.prefs.algoCalm()) {
      return 0;
    }
    return this.feed.posts().filter((p) => this.passesChips(p) && isHeated(p.status)).length;
  });

  ngOnInit(): void {
    this.feed.ensureBuilt();
  }

  sourceLabel(post: AlgoPost): string {
    return SOURCE_LABELS[post.source];
  }

  setAudience(audience: AlgoAudience): void {
    this.prefs.setAlgoAudience(audience);
  }

  toggleTags(): void {
    this.prefs.setAlgoTags(!this.prefs.algoTags());
  }

  toggleCalm(): void {
    this.prefs.setAlgoCalm(!this.prefs.algoCalm());
  }

  shuffle(): void {
    this.feed.shufflePosts();
  }

  refresh(): void {
    this.feed.refresh();
  }

  onChanged(post: AlgoPost, updated: Status): void {
    this.feed.updateStatus(post.status, updated);
  }

  onDeleted(removed: Status): void {
    this.feed.removeStatus(removed.id);
  }
}
