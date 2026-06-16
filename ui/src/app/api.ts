import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Account, Context, MastodonNotification, Relationship, Status } from './models';

/** Thin wrapper over the mastodon_mock REST API, served same-origin. */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  // --- auth / account ---
  verifyCredentials(): Observable<Account> {
    return this.http.get<Account>('/api/v1/accounts/verify_credentials');
  }

  getAccount(id: string): Observable<Account> {
    return this.http.get<Account>(`/api/v1/accounts/${id}`);
  }

  getAccountStatuses(id: string): Observable<Status[]> {
    return this.http.get<Status[]>(`/api/v1/accounts/${id}/statuses`);
  }

  relationships(ids: string[]): Observable<Relationship[]> {
    let params = new HttpParams();
    for (const id of ids) {
      params = params.append('id[]', id);
    }
    return this.http.get<Relationship[]>('/api/v1/accounts/relationships', { params });
  }

  follow(id: string): Observable<Relationship> {
    return this.http.post<Relationship>(`/api/v1/accounts/${id}/follow`, {});
  }

  unfollow(id: string): Observable<Relationship> {
    return this.http.post<Relationship>(`/api/v1/accounts/${id}/unfollow`, {});
  }

  // --- timelines ---
  homeTimeline(maxId?: string): Observable<Status[]> {
    return this.http.get<Status[]>('/api/v1/timelines/home', { params: this.pageParams(maxId) });
  }

  publicTimeline(local: boolean, maxId?: string): Observable<Status[]> {
    let params = this.pageParams(maxId);
    if (local) {
      params = params.set('local', 'true');
    }
    return this.http.get<Status[]>('/api/v1/timelines/public', { params });
  }

  // --- statuses ---
  getStatus(id: string): Observable<Status> {
    return this.http.get<Status>(`/api/v1/statuses/${id}`);
  }

  getContext(id: string): Observable<Context> {
    return this.http.get<Context>(`/api/v1/statuses/${id}/context`);
  }

  postStatus(status: string, inReplyToId?: string): Observable<Status> {
    const body: Record<string, string> = { status };
    if (inReplyToId) {
      body['in_reply_to_id'] = inReplyToId;
    }
    return this.http.post<Status>('/api/v1/statuses', body);
  }

  deleteStatus(id: string): Observable<Status> {
    return this.http.delete<Status>(`/api/v1/statuses/${id}`);
  }

  favourite(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/favourite`, {});
  }

  unfavourite(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/unfavourite`, {});
  }

  reblog(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/reblog`, {});
  }

  unreblog(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/unreblog`, {});
  }

  bookmark(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/bookmark`, {});
  }

  unbookmark(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/unbookmark`, {});
  }

  // --- notifications ---
  notifications(): Observable<MastodonNotification[]> {
    return this.http.get<MastodonNotification[]>('/api/v1/notifications');
  }

  private pageParams(maxId?: string): HttpParams {
    let params = new HttpParams().set('limit', '20');
    if (maxId) {
      params = params.set('max_id', maxId);
    }
    return params;
  }
}
