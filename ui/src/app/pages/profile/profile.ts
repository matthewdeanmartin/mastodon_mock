import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, Relationship, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { ReportDialog } from '../../report-dialog/report-dialog';
import { ListDialog } from '../../list-dialog/list-dialog';
import { VerifiedBadge } from '../../verified-badge/verified-badge';

@Component({
  selector: 'app-profile',
  imports: [RouterLink, StatusCard, ReportDialog, ListDialog, VerifiedBadge],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private auth = inject(Auth);
  private location = inject(Location);

  protected account = signal<Account | null>(null);
  protected statuses = signal<Status[]>([]);
  protected relationship = signal<Relationship | null>(null);
  protected loading = signal(true);

  protected showReport = signal(false);
  protected showLists = signal(false);
  protected reportDone = signal(false);
  protected showBlockConfirm = signal(false);

  protected isSelf = computed(() => this.account()?.id === this.auth.account()?.id);

  /** Accounts this profile features ("collections") — shown prominently up top. */
  protected featured = signal<Account[]>([]);
  /** Ids among featured() the viewer already follows (or has requested). */
  protected featuredFollowing = signal<Set<string>>(new Set());
  protected featuredBusy = signal(false);

  protected featuredToFollow = computed(() =>
    this.featured().filter(
      (f) => !this.featuredFollowing().has(f.id) && f.id !== this.auth.account()?.id,
    ),
  );

  /** Return to the previous page (e.g. back to search results). */
  goBack(): void {
    this.location.back();
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.load(id);
      }
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.relationship.set(null);
    this.reportDone.set(false);
    this.api.getAccount(id).subscribe((a) => {
      this.account.set(a);
      this.loading.set(false);
    });
    this.api.getAccountStatuses(id).subscribe((s) => this.statuses.set(s));
    this.api.relationships([id]).subscribe((rels) => this.relationship.set(rels[0] ?? null));
    this.loadFeatured(id);
  }

  private loadFeatured(id: string): void {
    this.featured.set([]);
    this.featuredFollowing.set(new Set());
    this.api.accountEndorsements(id).subscribe({
      next: (accounts) => {
        this.featured.set(accounts);
        if (!accounts.length) {
          return;
        }
        this.api.relationships(accounts.map((a) => a.id)).subscribe({
          next: (rels) =>
            this.featuredFollowing.set(
              new Set(rels.filter((r) => r.following || r.requested).map((r) => r.id)),
            ),
          error: () => {
            // Follow buttons just show for everyone; following again is harmless.
          },
        });
      },
      error: () => {
        // Older servers (pre-4.4) 404 here; the section simply doesn't render.
      },
    });
  }

  followFeatured(target: Account): void {
    this.api.follow(target.id).subscribe((rel) => {
      if (rel.following || rel.requested) {
        this.featuredFollowing.update((s) => new Set(s).add(target.id));
      }
    });
  }

  /** Follow every featured account the viewer doesn't already follow, one at a time. */
  async followAllFeatured(): Promise<void> {
    if (this.featuredBusy()) {
      return;
    }
    this.featuredBusy.set(true);
    try {
      for (const target of this.featuredToFollow()) {
        try {
          const rel = await firstValueFrom(this.api.follow(target.id));
          if (rel.following || rel.requested) {
            this.featuredFollowing.update((s) => new Set(s).add(target.id));
          }
        } catch {
          // Keep going; one failed follow shouldn't abort the batch.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      this.featuredBusy.set(false);
    }
  }

  toggleFollow(): void {
    const acc = this.account();
    const rel = this.relationship();
    if (!acc) {
      return;
    }
    const call = rel?.following ? this.api.unfollow(acc.id) : this.api.follow(acc.id);
    call.subscribe((updated) => this.relationship.set(updated));
  }

  toggleBlock(): void {
    const acc = this.account();
    const rel = this.relationship();
    if (!acc) {
      return;
    }
    const call = rel?.blocking ? this.api.unblockAccount(acc.id) : this.api.block(acc.id);
    call.subscribe((updated) => this.relationship.set(updated));
  }

  requestBlock(): void {
    if (this.relationship()?.blocking) {
      this.toggleBlock();
      return;
    }
    this.showBlockConfirm.set(true);
  }

  confirmBlock(): void {
    this.showBlockConfirm.set(false);
    this.toggleBlock();
  }

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }

  onReported(): void {
    this.showReport.set(false);
    this.reportDone.set(true);
  }
}
