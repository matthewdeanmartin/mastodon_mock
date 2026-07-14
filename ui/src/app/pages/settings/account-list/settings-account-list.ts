import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../../api';
import { Account } from '../../../models';

type Kind = 'mutes' | 'blocks';

/** Muted accounts / Blocked accounts — one component, chosen by route data `kind`. */
@Component({
  selector: 'app-settings-account-list',
  imports: [RouterLink],
  templateUrl: './settings-account-list.html',
  styleUrl: './settings-account-list.css',
})
export class SettingsAccountList implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  protected kind = signal<Kind>('mutes');
  protected accounts = signal<Account[]>([]);
  protected loading = signal(false);

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      this.kind.set((data['kind'] as Kind) ?? 'mutes');
      this.load();
    });
  }

  protected get title(): string {
    return this.kind() === 'mutes' ? 'Muted accounts' : 'Blocked accounts';
  }

  protected get subtitle(): string {
    return this.kind() === 'mutes'
      ? "You won't see posts or notifications from these accounts. They can still follow you."
      : "These accounts can't follow you, see your posts, or interact with you.";
  }

  private load(): void {
    this.loading.set(true);
    const call = this.kind() === 'mutes' ? this.api.mutes() : this.api.blocks();
    call.subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  undo(acc: Account): void {
    const call =
      this.kind() === 'mutes' ? this.api.unmuteAccount(acc.id) : this.api.unblockAccount(acc.id);
    call.subscribe(() => {
      this.accounts.update((list) => list.filter((a) => a.id !== acc.id));
    });
  }
}
