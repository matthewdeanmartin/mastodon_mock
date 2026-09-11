import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, Relationship, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { ReportDialog } from '../../report-dialog/report-dialog';
import { ListDialog } from '../../list-dialog/list-dialog';

@Component({
  selector: 'app-profile',
  imports: [StatusCard, ReportDialog, ListDialog],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private auth = inject(Auth);

  protected account = signal<Account | null>(null);
  protected statuses = signal<Status[]>([]);
  protected relationship = signal<Relationship | null>(null);
  protected loading = signal(true);

  protected showReport = signal(false);
  protected showLists = signal(false);
  protected reportDone = signal(false);

  protected isSelf = computed(() => this.account()?.id === this.auth.account()?.id);

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
