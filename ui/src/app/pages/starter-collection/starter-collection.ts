import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { ImportFollows } from '../../import-follows';
import { Account } from '../../models';
import { AnonymousPublicApi } from '../../providers/anonymous/anonymous-public-api';
import { anonymousAccountRouteRef } from '../../providers/anonymous/anonymous-route-ref';
import { STARTER_COLLECTION, StarterAccount } from '../../starter-collection';

@Component({
  selector: 'app-starter-collection',
  imports: [RouterLink],
  templateUrl: './starter-collection.html',
  styleUrl: './starter-collection.css',
})
export class StarterCollection implements OnInit {
  protected importer = inject(ImportFollows);
  private api = inject(Api);
  private auth = inject(Auth);
  private anonymousPublic = inject(AnonymousPublicApi);
  private router = inject(Router);
  protected accounts = STARTER_COLLECTION;
  protected opening = signal<string | null>(null);
  protected completed = computed(
    () =>
      this.importer
        .rows()
        .filter((row) => !['pending', 'resolving', 'following'].includes(row.status)).length,
  );
  protected followed = computed(
    () => this.importer.rows().filter((row) => row.status === 'followed').length,
  );

  ngOnInit(): void {
    this.importer.reset();
    if (this.auth.isAnonymous) {
      this.importer.loadResolved(this.accounts);
    } else {
      this.importer.load(this.accounts.map((account) => account.handle));
    }
  }

  followAll(): void {
    void this.importer.start();
  }

  status(handle: string): string {
    return this.importer.rows().find((row) => row.handle === handle)?.status ?? 'pending';
  }

  async openAccount(item: StarterAccount): Promise<void> {
    if (this.opening()) return;
    this.opening.set(item.handle);
    try {
      const resolved = this.importer.rows().find((row) => row.handle === item.handle)?.account;
      const account =
        resolved ?? (this.auth.isAnonymous ? item.account : await this.resolveAccount(item.handle));
      if (!account) return;
      if (this.auth.isAnonymous) {
        const server = this.serverFor(item.handle);
        await this.router.navigate([
          '/accounts',
          anonymousAccountRouteRef({
            server,
            id: account.id,
            ...(account.url ? { originalUrl: account.url } : {}),
          }),
        ]);
      } else {
        await this.router.navigate(['/accounts', account.id]);
      }
    } catch {
      // Leave the row usable so a transient lookup failure can be retried.
    } finally {
      this.opening.set(null);
    }
  }

  private async resolveAccount(handle: string): Promise<Account | null> {
    const username = handle.split('@')[0];
    const results = this.auth.isAnonymous
      ? await firstValueFrom(
          this.anonymousPublic.search(this.serverFor(handle), username, 'accounts'),
        )
      : await firstValueFrom(this.api.search(handle, 'accounts', { resolve: true, limit: 5 }));
    const normalized = handle.toLowerCase();
    return (
      results.accounts.find(
        (account) =>
          account.acct.toLowerCase() === normalized ||
          account.username.toLowerCase() === username.toLowerCase(),
      ) ??
      results.accounts[0] ??
      null
    );
  }

  private serverFor(handle: string): string {
    const host = handle.split('@').at(-1);
    return `https://${host}`;
  }
}
