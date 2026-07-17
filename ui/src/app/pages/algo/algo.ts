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

/**
 * ✨ Algo — the consumer-centric algorithmic feed. Content the user already
 * asked for, ranked by engagement, with client-side audience and calm-mode
 * filters. The expensive build lives in {@link AlgoFeed}; this page renders
 * the cached result and offers the explicit refresh.
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

  /** The cached feed with the audience + calm filters applied. */
  protected visible = computed(() => {
    const audience = this.prefs.algoAudience();
    const calm = this.prefs.algoCalm();
    return this.feed.posts().filter((p) => {
      if (audience === 'friends' && !p.friend) {
        return false;
      }
      if (audience === 'platform' && p.friend) {
        return false;
      }
      return !(calm && isHeated(p.status));
    });
  });

  /** How many posts calm mode is currently hiding, for the chip hint. */
  protected calmHidden = computed(() => {
    if (!this.prefs.algoCalm()) {
      return 0;
    }
    const audience = this.prefs.algoAudience();
    return this.feed
      .posts()
      .filter(
        (p) => (audience === 'all' || (audience === 'friends') === p.friend) && isHeated(p.status),
      ).length;
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

  toggleCalm(): void {
    this.prefs.setAlgoCalm(!this.prefs.algoCalm());
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
