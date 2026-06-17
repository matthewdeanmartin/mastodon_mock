import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../api';
import { Status } from '../../models';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';
import { Announcements } from '../../announcements/announcements';

@Component({
  selector: 'app-home',
  imports: [Compose, StatusCard, Announcements],
  templateUrl: './home.html',
})
export class Home implements OnInit {
  private api = inject(Api);

  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.homeTimeline().subscribe({
      next: (s) => {
        this.statuses.set(s);
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
    this.api.homeTimeline(maxId).subscribe((more) => this.statuses.update((s) => [...s, ...more]));
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
