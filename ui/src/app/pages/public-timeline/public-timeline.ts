import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { Api } from '../../api';
import { CommandBar } from '../../command-bar/command-bar';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { Streaming } from '../../streaming';

@Component({
  selector: 'app-public-timeline',
  imports: [CommandBar, StatusCard],
  templateUrl: './public-timeline.html',
})
export class PublicTimeline implements OnInit, OnDestroy {
  private api = inject(Api);
  private streaming = inject(Streaming);

  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected local = signal(false);
  protected live = signal(false);

  private liveSub: Subscription | null = null;
  private loadSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.liveSub?.unsubscribe();
    this.loadSub?.unsubscribe();
  }

  setLocal(local: boolean): void {
    if (this.local() === local) {
      return;
    }
    this.local.set(local);
    this.load();
    if (this.live()) {
      this.restartLive();
    }
  }

  toggleLive(): void {
    if (this.live()) {
      this.liveSub?.unsubscribe();
      this.liveSub = null;
      this.live.set(false);
      return;
    }
    this.live.set(true);
    // Going live starts from a fresh snapshot: refetch, then stream deltas on top.
    this.load();
    this.restartLive();
  }

  private restartLive(): void {
    this.liveSub?.unsubscribe();
    this.liveSub = this.streaming
      .open({ stream: 'public', local: this.local() })
      .subscribe(({ event, payload }) => {
        if (event === 'update') {
          this.statuses.update((list) => [payload as Status, ...list]);
        } else if (event === 'delete') {
          const id = payload as string;
          this.statuses.update((list) => list.filter((s) => s.id !== id));
        }
      });
  }

  load(): void {
    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.loadSub = this.api.publicTimeline(this.local()).subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
