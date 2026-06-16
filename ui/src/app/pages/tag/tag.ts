import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../api';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-tag',
  imports: [StatusCard],
  templateUrl: './tag.html',
})
export class Tag implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  protected tag = signal('');
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const tag = params.get('tag');
      if (tag) {
        this.tag.set(tag);
        this.load(tag);
      }
    });
  }

  load(tag: string): void {
    this.loading.set(true);
    this.api.tagTimeline(tag).subscribe({
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
}
