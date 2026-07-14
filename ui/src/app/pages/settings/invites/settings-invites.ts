import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { Invite } from '../../../models';

/** Invite links: generate, list, revoke. */
@Component({
  selector: 'app-settings-invites',
  imports: [FormsModule],
  templateUrl: './settings-invites.html',
  styleUrl: './settings-invites.css',
})
export class SettingsInvites implements OnInit {
  private api = inject(Api);

  protected invites = signal<Invite[]>([]);
  protected maxUses = signal<number | null>(null);
  protected expiresIn = signal<number | null>(null);
  protected creating = signal(false);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.api.invites().subscribe((list) => this.invites.set(list));
  }

  protected generate(): void {
    if (this.creating()) {
      return;
    }
    this.creating.set(true);
    this.api.createInvite({ max_uses: this.maxUses(), expires_in: this.expiresIn() }).subscribe({
      next: () => {
        this.creating.set(false);
        this.load();
      },
      error: () => this.creating.set(false),
    });
  }

  protected revoke(invite: Invite): void {
    this.api.revokeInvite(invite.id).subscribe((updated) => {
      this.invites.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
    });
  }

  protected formatDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : 'Never';
  }
}
