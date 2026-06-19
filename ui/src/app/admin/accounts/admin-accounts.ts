import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApi } from '../admin-api';
import { AdminAccount } from '../../models';

const STATUSES = ['active', 'pending', 'silenced', 'suspended', 'disabled'] as const;

@Component({
  selector: 'app-admin-accounts',
  imports: [RouterLink],
  templateUrl: './admin-accounts.html',
  styleUrl: './admin-accounts.css',
})
export class AdminAccounts implements OnInit {
  private api = inject(AdminApi);

  protected readonly statuses = STATUSES;
  protected status = signal<string>('active');
  protected accounts = signal<AdminAccount[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  setStatus(status: string): void {
    if (this.status() === status) {
      return;
    }
    this.status.set(status);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.accounts(this.status()).subscribe({
      next: (a) => {
        this.accounts.set(a);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // After a state change the account usually moves between status tabs, so reload
  // the current view rather than patching one row. (The /action endpoint also
  // returns an empty body, so there is nothing to patch from.)
  moderate(a: AdminAccount, type: string): void {
    this.api.moderate(a.id, type).subscribe(() => this.load());
  }

  unsilence(a: AdminAccount): void {
    this.api.unsilence(a.id).subscribe(() => this.load());
  }

  unsuspend(a: AdminAccount): void {
    this.api.unsuspend(a.id).subscribe(() => this.load());
  }

  enable(a: AdminAccount): void {
    this.api.enable(a.id).subscribe(() => this.load());
  }

  approve(a: AdminAccount): void {
    this.api.approve(a.id).subscribe(() => this.load());
  }

  reject(a: AdminAccount): void {
    if (!confirm(`Reject and delete the pending registration for @${a.username}?`)) {
      return;
    }
    this.api.reject(a.id).subscribe(() => this.load());
  }

  unsensitive(a: AdminAccount): void {
    this.api.unsensitive(a.id).subscribe(() => this.load());
  }

  remove(a: AdminAccount): void {
    if (!confirm(`Permanently delete @${a.username}? This cannot be undone.`)) {
      return;
    }
    this.api.deleteAccount(a.id).subscribe(() => this.load());
  }
}
