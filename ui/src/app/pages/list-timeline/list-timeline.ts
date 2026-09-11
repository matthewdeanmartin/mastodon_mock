import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../api';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-list-timeline',
  imports: [StatusCard],
  templateUrl: './list-timeline.html',
})
export class ListTimeline implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  protected title = signal('');
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.load(id);
      }
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.api.getList(id).subscribe((l) => this.title.set(l.title));
    this.api.listTimeline(id).subscribe({
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
