import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api } from '../../api';
import { ClientPrefs } from '../../client-prefs';
import { MastodonNotification } from '../../models';
import { Streaming } from '../../streaming';
import { Compose } from '../../compose/compose';

@Component({
  selector: 'app-notifications',
  imports: [RouterLink, Compose],
  templateUrl: './notifications.html',
  styleUrl: './notifications.css',
})
export class Notifications implements OnInit, OnDestroy {
  private api = inject(Api);
  private streaming = inject(Streaming);
  private prefs = inject(ClientPrefs);

  /** Media thumbnails respect the feed-wide images on/off preference. */
  protected showImages = this.prefs.showImages;

  protected items = signal<MastodonNotification[]>([]);
  protected loading = signal(true);
  protected live = signal(false);

  private liveSub: Subscription | null = null;

  ngOnInit(): void {
    this.api.notifications().subscribe({
      next: (n) => {
        this.items.set(n);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  ngOnDestroy(): void {
    this.liveSub?.unsubscribe();
  }

  toggleLive(): void {
    if (this.live()) {
      this.liveSub?.unsubscribe();
      this.liveSub = null;
      this.live.set(false);
      return;
    }
    this.live.set(true);
    this.liveSub = this.streaming.open({ stream: 'user' }).subscribe(({ event, payload }) => {
      if (event === 'notification') {
        this.items.update((list) => [payload as MastodonNotification, ...list]);
      }
    });
  }

  label(type: string): string {
    switch (type) {
      case 'favourite':
        return 'favourited your status';
      case 'reblog':
        return 'boosted your status';
      case 'follow':
        return 'followed you';
      case 'mention':
        return 'mentioned you';
      default:
        return type;
    }
  }
}
