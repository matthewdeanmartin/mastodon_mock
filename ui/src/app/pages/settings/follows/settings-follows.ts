import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../../api';
import { Account } from '../../../models';
import { Auth } from '../../../auth';
import { AnonymousFollow, AnonymousFollows } from '../../../providers/anonymous/anonymous-follows';
import { anonymousAccountRouteRef } from '../../../providers/anonymous/anonymous-route-ref';

/** Follows and followers: pending follow requests. */
@Component({
  selector: 'app-settings-follows',
  imports: [RouterLink],
  templateUrl: './settings-follows.html',
  styleUrl: './settings-follows.css',
})
export class SettingsFollows implements OnInit {
  private api = inject(Api);
  protected auth = inject(Auth);
  protected anonymousFollows = inject(AnonymousFollows);

  protected requests = signal<Account[]>([]);
  protected loading = signal(false);

  ngOnInit(): void {
    if (this.auth.isAnonymous) {
      this.requests.set(this.anonymousFollows.follows().map((follow) => follow.account));
      return;
    }
    this.loading.set(true);
    this.api.followRequests().subscribe({
      next: (accounts) => {
        this.requests.set(accounts);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected followFor(account: Account): AnonymousFollow | null {
    return (
      this.anonymousFollows
        .follows()
        .find(
          (follow) =>
            follow.account === account ||
            (follow.account.id === account.id && follow.account.acct === account.acct),
        ) ?? null
    );
  }

  protected accountLink(account: Account): (string | number)[] {
    const follow = this.followFor(account);
    return follow
      ? [
          '/accounts',
          anonymousAccountRouteRef({
            server: follow.server,
            id: follow.account.id,
            originalUrl: follow.profileUrl,
          }),
        ]
      : ['/accounts', account.id];
  }

  protected sourceStatus(follow: AnonymousFollow): string {
    if (!follow.apiRetryAfter || Date.parse(follow.apiRetryAfter) <= Date.now())
      return 'Public API';
    return follow.preferredSource === 'rss'
      ? 'Using RSS fallback temporarily'
      : 'Temporarily deferred after API and RSS failed';
  }

  retry(follow: AnonymousFollow): void {
    this.anonymousFollows.clearBackoff(follow.key);
  }

  unfollow(follow: AnonymousFollow): void {
    this.anonymousFollows.unfollow(follow.account, follow.server);
    this.requests.update((accounts) => accounts.filter((account) => account !== follow.account));
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
