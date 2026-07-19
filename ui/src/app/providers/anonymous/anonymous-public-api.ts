import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, timeout } from 'rxjs';
import { AccountStatusesOptions } from '../../api';
import { Account, Context, Status } from '../../models';
import { externalFetch } from '../external-fetch';
import { adaptAnonymousAccount, adaptAnonymousStatus } from './anonymous-mastodon-provider';
import { AnonymousPublicRef } from './anonymous-route-ref';

const REQUEST_TIMEOUT_MS = 8_000;

/** Read-only public Mastodon API calls used by Anonymous profile and thread routes. */
@Injectable({ providedIn: 'root' })
export class AnonymousPublicApi {
  private http = inject(HttpClient);

  getAccount(ref: AnonymousPublicRef): Observable<Account> {
    return this.http
      .get<Account>(`${ref.server}/api/v1/accounts/${encodeURIComponent(ref.id)}`, {
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((account) => adaptAnonymousAccount(account, ref.server)),
      );
  }

  getAccountStatuses(
    ref: AnonymousPublicRef,
    opts: AccountStatusesOptions = {},
  ): Observable<Status[]> {
    let params = new HttpParams();
    if (opts.excludeReplies) params = params.set('exclude_replies', 'true');
    if (opts.excludeReblogs) params = params.set('exclude_reblogs', 'true');
    if (opts.pinned) params = params.set('pinned', 'true');
    if (opts.maxId) params = params.set('max_id', opts.maxId);
    if (opts.limit) params = params.set('limit', String(opts.limit));
    return this.http
      .get<Status[]>(`${ref.server}/api/v1/accounts/${encodeURIComponent(ref.id)}/statuses`, {
        params,
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((statuses) => statuses.map((status) => adaptAnonymousStatus(status, ref.server))),
      );
  }

  getStatus(ref: AnonymousPublicRef): Observable<Status> {
    return this.http
      .get<Status>(`${ref.server}/api/v1/statuses/${encodeURIComponent(ref.id)}`, {
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((status) => adaptAnonymousStatus(status, ref.server)),
      );
  }

  getContext(ref: AnonymousPublicRef): Observable<Context> {
    return this.http
      .get<Context>(`${ref.server}/api/v1/statuses/${encodeURIComponent(ref.id)}/context`, {
        context: externalFetch(),
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        map((context) => ({
          ancestors: context.ancestors.map((status) => adaptAnonymousStatus(status, ref.server)),
          descendants: context.descendants.map((status) =>
            adaptAnonymousStatus(status, ref.server),
          ),
        })),
      );
  }
}
