import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../api';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-favourites',
  imports: [StatusCard],
  templateUrl: './favourites.html',
})
export class Favourites implements OnInit {
  private api = inject(Api);

  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.api.favourites().subscribe({
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
