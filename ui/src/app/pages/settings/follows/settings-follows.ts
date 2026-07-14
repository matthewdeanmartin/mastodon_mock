import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../../api';
import { Account } from '../../../models';

/** Follows and followers: pending follow requests. */
@Component({
  selector: 'app-settings-follows',
  imports: [RouterLink],
  templateUrl: './settings-follows.html',
  styleUrl: './settings-follows.css',
})
export class SettingsFollows implements OnInit {
  private api = inject(Api);

  protected requests = signal<Account[]>([]);
  protected loading = signal(false);

  ngOnInit(): void {
    this.loading.set(true);
    this.api.followRequests().subscribe({
      next: (accounts) => {
        this.requests.set(accounts);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  authorize(acc: Account): void {
    this.api.authorizeFollowRequest(acc.id).subscribe(() => {
      this.requests.update((list) => list.filter((a) => a.id !== acc.id));
    });
  }

  reject(acc: Account): void {
    this.api.rejectFollowRequest(acc.id).subscribe(() => {
      this.requests.update((list) => list.filter((a) => a.id !== acc.id));
    });
  }
}
