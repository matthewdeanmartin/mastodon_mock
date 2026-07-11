import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { Api } from '../../api';
import { Status } from '../../models';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';
import { Announcements } from '../../announcements/announcements';
import { Streaming } from '../../streaming';
import { HomeTimelineFeed } from '../../home-timeline-feed';

@Component({
  selector: 'app-home',
  imports: [Compose, StatusCard, Announcements],
  templateUrl: './home.html',
})
export class Home implements OnInit, OnDestroy {
  private api = inject(Api);
  private streaming = inject(Streaming);
  private homeTimelineFeed = inject(HomeTimelineFeed);

  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected live = signal(false);

  private liveSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
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
      if (event === 'update') {
        this.statuses.update((list) => [payload as Status, ...list]);
      } else if (event === 'delete') {
        const id = payload as string;
        this.statuses.update((list) => list.filter((s) => s.id !== id));
      }
    });
  }

  load(): void {
    this.loading.set(true);
    this.api.homeTimeline().subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.homeTimelineFeed.publish(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadMore(): void {
    const current = this.statuses();
    const maxId = current.at(-1)?.id;
    if (!maxId) {
      return;
    }
    this.api.homeTimeline(maxId).subscribe((more) => {
      this.statuses.update((s) => [...s, ...more]);
      this.homeTimelineFeed.publish(more);
    });
  }

  onPosted(status: Status): void {
    this.statuses.update((s) => [status, ...s]);
  }

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
