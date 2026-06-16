import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../api';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-public-timeline',
  imports: [StatusCard],
  templateUrl: './public-timeline.html',
})
export class PublicTimeline implements OnInit {
  private api = inject(Api);

  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected local = signal(false);

  ngOnInit(): void {
    this.load();
  }

  setLocal(local: boolean): void {
    if (this.local() === local) {
      return;
    }
    this.local.set(local);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.publicTimeline(this.local()).subscribe({
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
