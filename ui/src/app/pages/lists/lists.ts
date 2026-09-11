import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { UserList } from '../../models';

@Component({
  selector: 'app-lists',
  imports: [RouterLink, FormsModule],
  templateUrl: './lists.html',
  styleUrl: './lists.css',
})
export class Lists implements OnInit {
  private api = inject(Api);

  protected lists = signal<UserList[]>([]);
  protected loading = signal(true);
  protected newTitle = signal('');

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.lists().subscribe({
      next: (l) => {
        this.lists.set(l);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  create(): void {
    const title = this.newTitle().trim();
    if (!title) {
      return;
    }
    this.api.createList(title).subscribe((list) => {
      this.lists.update((l) => [...l, list]);
      this.newTitle.set('');
    });
  }

  remove(list: UserList, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.api.deleteList(list.id).subscribe(() => {
      this.lists.update((l) => l.filter((x) => x.id !== list.id));
    });
  }
}
