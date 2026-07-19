import { Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImportFollows } from '../../import-follows';
import { STARTER_COLLECTION } from '../../starter-collection';

@Component({
  selector: 'app-starter-collection',
  imports: [RouterLink],
  templateUrl: './starter-collection.html',
  styleUrl: './starter-collection.css',
})
export class StarterCollection implements OnInit {
  protected importer = inject(ImportFollows);
  protected accounts = STARTER_COLLECTION;
  protected completed = computed(
    () =>
      this.importer
        .rows()
        .filter((row) => !['pending', 'resolving', 'following'].includes(row.status)).length,
  );
  protected followed = computed(
    () => this.importer.rows().filter((row) => row.status === 'followed').length,
  );

  ngOnInit(): void {
    this.importer.reset();
    this.importer.load(this.accounts.map((account) => account.handle));
  }

  followAll(): void {
    void this.importer.start();
  }

  status(handle: string): string {
    return this.importer.rows().find((row) => row.handle === handle)?.status ?? 'pending';
  }
}
