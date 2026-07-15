import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Api } from '../../api';
import { ClientPrefs } from '../../client-prefs';
import { MastodonNotification, Relationship } from '../../models';
import { Streaming } from '../../streaming';
import { Compose } from '../../compose/compose';

type NotifAudience = 'all' | 'friends' | 'followers';

@Component({
  selector: 'app-notifications',
  imports: [RouterLink, Compose, FormsModule],
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

  // List filters: who the notification is from, and what kind it is.
  protected audience = signal<NotifAudience>('all');
  protected typeFilter = signal<string>('all');

  /** Relationships for the friends/followers filters; fetched lazily. */
  private rels = signal<Map<string, Relationship>>(new Map());
  private requestedRels = new Set<string>();

  /** Distinct notification types present, for the type dropdown. */
  protected types = computed(() => [...new Set(this.items().map((n) => n.type))].sort());

  protected visible = computed(() => {
    const type = this.typeFilter();
    const audience = this.audience();
    const rels = this.rels();
    return this.items().filter((n) => {
      if (type !== 'all' && n.type !== type) {
        return false;
      }
      if (audience === 'all') {
        return true;
      }
      const r = rels.get(n.account.id);
      return audience === 'friends' ? !!r?.following : !!r?.followed_by;
    });
  });

  constructor() {
    effect(() => {
      if (this.audience() === 'all') {
        return;
      }
      const missing = [
        ...new Set(
          this.items()
            .map((n) => n.account.id)
            .filter((id) => !this.requestedRels.has(id)),
        ),
      ];
      if (!missing.length) {
        return;
      }
      for (const id of missing) {
        this.requestedRels.add(id);
      }
      this.api.relationships(missing).subscribe((list) => {
        this.rels.update((map) => {
          const next = new Map(map);
          for (const r of list) {
            next.set(r.id, r);
          }
          return next;
        });
      });
    });
  }

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
