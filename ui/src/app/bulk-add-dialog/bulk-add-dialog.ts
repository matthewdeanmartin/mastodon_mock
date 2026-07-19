import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { concatMap, from, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Api } from '../api';
import { Auth } from '../auth';
import { Account, SearchResults } from '../models';
import { AnonymousAccount } from '../providers/anonymous/anonymous-account';
import { AnonymousFollows } from '../providers/anonymous/anonymous-follows';
import { AnonymousLists } from '../providers/anonymous/anonymous-lists';
import { AnonymousPublicApi } from '../providers/anonymous/anonymous-public-api';

/** One line of the bulk add-by-name result. */
interface BulkResult {
  handle: string;
  status: 'added' | 'notfound' | 'error';
}

/**
 * Bulk "add people by name" into a single, already-known target (the list or
 * collection whose page hosts this dialog). Paste one handle, a CSV, or one
 * handle per line; each is resolved via search and added sequentially.
 */
@Component({
  selector: 'app-bulk-add-dialog',
  imports: [FormsModule],
  templateUrl: './bulk-add-dialog.html',
  styleUrl: './bulk-add-dialog.css',
})
export class BulkAddDialog {
  private api = inject(Api);
  private auth = inject(Auth);
  private anonymous = inject(AnonymousAccount);
  private anonymousFollows = inject(AnonymousFollows);
  private anonymousLists = inject(AnonymousLists);
  private anonymousPublic = inject(AnonymousPublicApi);

  readonly targetId = input.required<string>();
  readonly targetKind = input.required<'list' | 'collection'>();
  /** Display name for the heading (list title / collection name). */
  readonly targetName = input<string>('');
  /** Fires with the number of accounts successfully added, once, on finish. */
  readonly added = output<number>();
  readonly closed = output<void>();

  protected handles = signal('');
  protected busy = signal(false);
  protected results = signal<BulkResult[]>([]);

  /** Split a paste into handles: comma, newline, or whitespace separated. */
  protected parseHandles(raw: string): string[] {
    return raw
      .split(/[\s,]+/)
      .map((h) => h.replace(/^@/, ''))
      .filter((h) => h.length > 0);
  }

  protected count(): number {
    return this.parseHandles(this.handles()).length;
  }

  add(): void {
    const handles = this.parseHandles(this.handles());
    if (!handles.length || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.results.set([]);

    from(handles)
      .pipe(concatMap((handle) => this.resolveAndAdd(handle)))
      .subscribe({
        next: (result) => this.results.update((r) => [...r, result]),
        complete: () => {
          this.busy.set(false);
          this.added.emit(this.results().filter((r) => r.status === 'added').length);
        },
        error: () => this.busy.set(false),
      });
  }

  /** Resolve one handle to an account and add it; never errors the outer stream. */
  private resolveAndAdd(handle: string): Observable<BulkResult> {
    return this.search(handle).pipe(
      switchMap((res) => {
        const account = res.accounts[0];
        if (!account) {
          return of<BulkResult>({ handle, status: 'notfound' });
        }
        return this.addAccount(account, handle).pipe(
          map(() => ({ handle, status: 'added' }) as BulkResult),
          catchError(() => of<BulkResult>({ handle, status: 'error' })),
        );
      }),
      catchError(() => of<BulkResult>({ handle, status: 'error' })),
    );
  }

  private search(handle: string): Observable<SearchResults> {
    return this.auth.isAnonymous
      ? this.anonymousPublic.search(this.serverFor(handle), handle.split('@')[0], 'accounts')
      : this.api.search(handle, 'accounts', { resolve: true, limit: 1 });
  }

  private addAccount(account: Account, handle: string): Observable<unknown> {
    if (!this.auth.isAnonymous) {
      return this.targetKind() === 'list'
        ? this.api.addToList(this.targetId(), account.id)
        : this.api.addCollectionAccount(this.targetId(), account.id);
    }
    if (this.targetKind() !== 'list') {
      throw new Error('Anonymous collections are read-only.');
    }
    const result = this.anonymousFollows.follow(account, this.serverFor(handle));
    const follow = this.anonymousFollows.findByAccountId(account.id);
    if (!result.ok || !follow) {
      throw new Error(result.ok ? 'Could not save the account.' : result.error);
    }
    this.anonymousLists.setMember(this.targetId(), follow.key, true);
    return of({});
  }

  private serverFor(handle: string): string {
    const host = handle.includes('@') ? handle.split('@').at(-1) : null;
    return host ? `https://${host}` : this.anonymous.server();
  }
}
