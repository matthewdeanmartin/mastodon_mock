import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import { Api } from '../api';
import { UserList } from '../models';

interface ListRow {
  list: UserList;
  member: boolean;
}

@Component({
  selector: 'app-list-dialog',
  imports: [FormsModule],
  templateUrl: './list-dialog.html',
  styleUrl: './list-dialog.css',
})
export class ListDialog implements OnInit {
  private api = inject(Api);

  readonly username = input.required<string>();
  readonly accountId = input.required<string>();
  readonly closed = output<void>();

  protected rows = signal<ListRow[]>([]);
  protected loading = signal(true);
  protected newTitle = signal('');

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.lists().subscribe((lists) => {
      if (!lists.length) {
        this.rows.set([]);
        this.loading.set(false);
        return;
      }
      // For each list, check whether this account is already a member.
      forkJoin(
        lists.map((list) =>
          this.api.listAccounts(list.id).pipe(
            map((accounts) => ({
              list,
              member: accounts.some((a) => a.id === this.accountId()),
            })),
          ),
        ),
      ).subscribe((rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      });
    });
  }

  toggle(row: ListRow): void {
    const call = row.member
      ? this.api.removeFromList(row.list.id, this.accountId())
      : this.api.addToList(row.list.id, this.accountId());
    call.subscribe(() => {
      this.rows.update((rows) =>
        rows.map((r) => (r.list.id === row.list.id ? { ...r, member: !r.member } : r)),
      );
    });
  }

  createAndAdd(): void {
    const title = this.newTitle().trim();
    if (!title) {
      return;
    }
    this.api.createList(title).subscribe((list) => {
      this.newTitle.set('');
      this.api.addToList(list.id, this.accountId()).subscribe(() => {
        this.rows.update((rows) => [...rows, { list, member: true }]);
      });
    });
  }
}
