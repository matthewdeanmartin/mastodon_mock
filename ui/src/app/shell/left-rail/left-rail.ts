import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account } from '../../models';

/**
 * Left sidebar: the signed-in user's profile card (2018-Twitter style) and a
 * "Who to follow" widget. Suggestions are derived synthetically: accounts whose
 * posts were boosted by other people on the public timeline, uniquified, minus
 * yourself and anyone you already follow.
 */
@Component({
  selector: 'app-left-rail',
  imports: [RouterLink],
  templateUrl: './left-rail.html',
  styleUrl: './left-rail.css',
})
export class LeftRail implements OnInit {
  protected auth = inject(Auth);
  private api = inject(Api);

  protected suggestions = signal<Account[]>([]);
  /** Ids the user followed from this widget (flips the button to "Following"). */
  protected followed = signal<Set<string>>(new Set());

  ngOnInit(): void {
    this.api.publicTimeline(false).subscribe({
      next: (statuses) => {
        const me = this.auth.account()?.id;
        const seen = new Map<string, Account>();
        for (const s of statuses) {
          const boosted = s.reblog?.account;
          if (boosted && boosted.id !== me && boosted.id !== s.account.id) {
            seen.set(boosted.id, boosted);
          }
        }
        if (!seen.size) {
          return;
        }
        const ids = [...seen.keys()];
        this.api.relationships(ids).subscribe({
          next: (rels) => {
            const excluded = new Set(
              rels.filter((r) => r.following || r.requested || r.blocking).map((r) => r.id),
            );
            this.suggestions.set(ids.filter((id) => !excluded.has(id)).map((id) => seen.get(id)!));
          },
          error: () => this.suggestions.set([...seen.values()]),
        });
      },
      error: () => {
        // Sidebar widget: fail silently, the timeline is the main event.
      },
    });
  }

  follow(account: Account): void {
    this.api.follow(account.id).subscribe({
      next: () => this.followed.update((set) => new Set(set).add(account.id)),
      error: () => {
        // Leave the button as-is; the user can retry.
      },
    });
  }
}
