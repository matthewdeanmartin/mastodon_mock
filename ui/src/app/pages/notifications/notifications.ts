import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { MastodonNotification } from '../../models';

@Component({
  selector: 'app-notifications',
  imports: [RouterLink],
  templateUrl: './notifications.html',
  styleUrl: './notifications.css',
})
export class Notifications implements OnInit {
  private api = inject(Api);

  protected items = signal<MastodonNotification[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.api.notifications().subscribe({
      next: (n) => {
        this.items.set(n);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
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
