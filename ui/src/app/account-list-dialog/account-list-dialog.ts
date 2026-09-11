import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { Api } from '../api';
import { Account } from '../models';

/** Which set of accounts to show for a status. */
export type AccountListMode = 'favourited_by' | 'reblogged_by';

const TITLES: Record<AccountListMode, string> = {
  favourited_by: 'Favourited by',
  reblogged_by: 'Boosted by',
};

/** A modal listing the accounts that favourited or boosted a status. */
@Component({
  selector: 'app-account-list-dialog',
  imports: [RouterLink],
  templateUrl: './account-list-dialog.html',
  styleUrl: './account-list-dialog.css',
})
export class AccountListDialog implements OnInit {
  private api = inject(Api);

  readonly statusId = input.required<string>();
  readonly mode = input.required<AccountListMode>();
  readonly closed = output<void>();

  protected accounts = signal<Account[]>([]);
  protected loading = signal(true);

  protected get title(): string {
    return TITLES[this.mode()];
  }

  ngOnInit(): void {
    const call: Observable<Account[]> =
      this.mode() === 'favourited_by'
        ? this.api.favouritedBy(this.statusId())
        : this.api.rebloggedBy(this.statusId());
    call.subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
