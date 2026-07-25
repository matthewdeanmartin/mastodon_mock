import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AccountHoverCard } from '../account-hover-card/account-hover-card';
import { Api } from '../api';
import { Auth } from '../auth';
import { ImportFollows } from '../import-follows';
import { Account } from '../models';
import { ShippedStarterKit } from '../starter-kits';

@Component({
  selector: 'app-starter-kit-post',
  imports: [AccountHoverCard],
  providers: [ImportFollows],
  templateUrl: './starter-kit-post.html',
  styleUrl: './starter-kit-post.css',
})
export class StarterKitPost implements OnInit {
  protected readonly auth = inject(Auth);
  protected readonly importer = inject(ImportFollows);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  readonly kit = input.required<ShippedStarterKit>();
  protected readonly resolved = signal(new Map<string, Account>());
  protected readonly resolving = signal(new Set<string>());
  protected readonly opening = signal<string | null>(null);
  private readonly resolutionRequests = new Map<string, Promise<Account | null>>();
  protected readonly completed = computed(
    () =>
      this.importer
        .rows()
        .filter((row) => !['pending', 'resolving', 'following'].includes(row.status)).length,
  );
  protected readonly followed = computed(
    () => this.importer.rows().filter((row) => row.status === 'followed').length,
  );

  ngOnInit(): void {
    if (!this.auth.isAnonymous) {
      this.importer.load(this.kit().accounts.map((account) => account.acct));
    }
  }

  protected accountFor(account: Account): Account {
    return this.resolved().get(account.acct.toLowerCase()) ?? account;
  }

  protected isResolved(account: Account): boolean {
    return this.resolved().has(account.acct.toLowerCase());
  }

  protected prepareAccount(account: Account): void {
    void this.resolveAccount(account);
  }

  protected async openAccount(account: Account): Promise<void> {
    if (this.opening()) return;
    this.opening.set(account.acct);
    try {
      const resolved = await this.resolveAccount(account);
      if (resolved) {
        await this.router.navigate(['/accounts', resolved.id]);
      }
    } finally {
      this.opening.set(null);
    }
  }

  protected followPreview(): void {
    void this.importer.start();
  }

  private async resolveAccount(account: Account): Promise<Account | null> {
    const key = account.acct.toLowerCase();
    const cached = this.resolved().get(key);
    if (cached) return cached;
    if (this.auth.isAnonymous) return null;
    const pending = this.resolutionRequests.get(key);
    if (pending) return pending;

    const request = this.fetchAccount(account, key);
    this.resolutionRequests.set(key, request);
    return request;
  }

  private async fetchAccount(account: Account, key: string): Promise<Account | null> {
    this.resolving.update((current) => new Set(current).add(key));
    try {
      const results = await firstValueFrom(
        this.api.search(account.acct, 'accounts', { resolve: true, limit: 5 }),
      );
      const resolved =
        results.accounts.find((candidate) => candidate.acct.toLowerCase() === key) ??
        results.accounts.find(
          (candidate) => candidate.username.toLowerCase() === account.username.toLowerCase(),
        ) ??
        results.accounts[0] ??
        null;
      if (resolved) {
        this.resolved.update((current) => new Map(current).set(key, resolved));
      }
      return resolved;
    } catch {
      return null;
    } finally {
      this.resolutionRequests.delete(key);
      this.resolving.update((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }
}
