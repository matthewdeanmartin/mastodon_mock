import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Account, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-list-timeline',
  imports: [RouterLink, StatusCard],
  templateUrl: './list-timeline.html',
  styleUrl: './list-timeline.css',
})
export class ListTimeline implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  protected title = signal('');
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected tab = signal<'posts' | 'members'>('posts');

  // Members are fetched lazily, the first time the tab is opened.
  protected members = signal<Account[]>([]);
  protected membersLoading = signal(false);
  private membersLoadedFor = '';
  private listId = '';

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.listId = id;
        this.tab.set('posts');
        this.membersLoadedFor = '';
        this.load(id);
      }
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.api.getList(id).subscribe((l) => this.title.set(l.title));
    this.api.listTimeline(id).subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setTab(tab: 'posts' | 'members'): void {
    this.tab.set(tab);
    if (tab === 'members' && this.membersLoadedFor !== this.listId) {
      this.loadMembers();
    }
  }

  loadMembers(): void {
    this.membersLoading.set(true);
    this.membersLoadedFor = this.listId;
    this.api.listAccounts(this.listId).subscribe({
      next: (accounts) => {
        this.members.set(accounts);
        this.membersLoading.set(false);
      },
      error: () => this.membersLoading.set(false),
    });
  }

  removeMember(account: Account): void {
    this.api.removeFromList(this.listId, account.id).subscribe(() => {
      this.members.update((m) => m.filter((a) => a.id !== account.id));
    });
  }

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
