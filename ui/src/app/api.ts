import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Account,
  Announcement,
  Context,
  CustomEmoji,
  DevUser,
  GenerationReport,
  InstanceRule,
  MastodonNotification,
  Relationship,
  SearchResults,
  Status,
  StatusSource,
  TermsOfService,
  UserList,
} from './models';

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

  tagTimeline(tag: string, maxId?: string): Observable<Status[]> {
    return this.http.get<Status[]>(`/api/v1/timelines/tag/${encodeURIComponent(tag)}`, {
      params: this.pageParams(maxId),
    });
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

  getStatusSource(id: string): Observable<StatusSource> {
    return this.http.get<StatusSource>(`/api/v1/statuses/${id}/source`);
  }

  editStatus(id: string, status: string, spoilerText?: string): Observable<Status> {
    const body: Record<string, string> = { status };
    if (spoilerText !== undefined) {
      body['spoiler_text'] = spoilerText;
    }
    return this.http.put<Status>(`/api/v1/statuses/${id}`, body);
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

  // --- favourites / bookmarks ---
  favourites(): Observable<Status[]> {
    return this.http.get<Status[]>('/api/v1/favourites');
  }

  bookmarks(): Observable<Status[]> {
    return this.http.get<Status[]>('/api/v1/bookmarks');
  }

  // --- search ---
  search(q: string, type?: 'accounts' | 'statuses' | 'hashtags'): Observable<SearchResults> {
    let params = new HttpParams().set('q', q);
    if (type) {
      params = params.set('type', type);
    }
    return this.http.get<SearchResults>('/api/v2/search', { params });
  }

  // --- lists ---
  lists(): Observable<UserList[]> {
    return this.http.get<UserList[]>('/api/v1/lists');
  }

  getList(id: string): Observable<UserList> {
    return this.http.get<UserList>(`/api/v1/lists/${id}`);
  }

  listTimeline(id: string, maxId?: string): Observable<Status[]> {
    return this.http.get<Status[]>(`/api/v1/timelines/list/${id}`, { params: this.pageParams(maxId) });
  }

  // create_list / update_list take form-encoded params, not JSON.
  createList(title: string): Observable<UserList> {
    const body = new HttpParams().set('title', title);
    return this.http.post<UserList>('/api/v1/lists', body);
  }

  deleteList(id: string): Observable<unknown> {
    return this.http.delete(`/api/v1/lists/${id}`);
  }

  listAccounts(id: string): Observable<Account[]> {
    return this.http.get<Account[]>(`/api/v1/lists/${id}/accounts`);
  }

  addToList(id: string, accountId: string): Observable<unknown> {
    return this.http.post(`/api/v1/lists/${id}/accounts`, { account_ids: [accountId] });
  }

  removeFromList(id: string, accountId: string): Observable<unknown> {
    return this.http.request('delete', `/api/v1/lists/${id}/accounts`, {
      body: { account_ids: [accountId] },
    });
  }

  // --- reports ---
  report(accountId: string, category: string, comment: string, statusIds?: string[]): Observable<unknown> {
    const body: Record<string, unknown> = { account_id: accountId, category };
    if (comment.trim()) {
      body['comment'] = comment.trim();
    }
    if (statusIds?.length) {
      body['status_ids'] = statusIds;
    }
    return this.http.post('/api/v1/reports', body);
  }

  // --- announcements ---
  announcements(): Observable<Announcement[]> {
    return this.http.get<Announcement[]>('/api/v1/announcements');
  }

  dismissAnnouncement(id: string): Observable<unknown> {
    return this.http.post(`/api/v1/announcements/${id}/dismiss`, {});
  }

  addAnnouncementReaction(id: string, name: string): Observable<unknown> {
    return this.http.put(`/api/v1/announcements/${id}/reactions/${encodeURIComponent(name)}`, {});
  }

  removeAnnouncementReaction(id: string, name: string): Observable<unknown> {
    return this.http.delete(`/api/v1/announcements/${id}/reactions/${encodeURIComponent(name)}`);
  }

  // --- instance "about" info ---
  instanceRules(): Observable<InstanceRule[]> {
    return this.http.get<InstanceRule[]>('/api/v1/instance/rules');
  }

  // The endpoint 404s when no ToS is configured; callers treat that as "none".
  termsOfService(): Observable<TermsOfService> {
    return this.http.get<TermsOfService>('/api/v1/instance/terms_of_service');
  }

  customEmojis(): Observable<CustomEmoji[]> {
    return this.http.get<CustomEmoji[]>('/api/v1/custom_emojis');
  }

  // --- mock-only dev helpers (login screen) ---
  createDevUser(admin: boolean): Observable<DevUser> {
    return this.http.post<DevUser>('/api/v1/_mock/dev_user', { admin });
  }

  listDevUsers(): Observable<DevUser[]> {
    return this.http.get<DevUser[]>('/api/v1/_mock/dev_users');
  }

  /** Mock-only: bulk-generate a throwaway sample cohort using a named preset. */
  seedSampleData(preset: string): Observable<{ report: GenerationReport }> {
    return this.http.post<{ report: GenerationReport }>('/api/v1/_mock/sample_data', { preset });
  }

  private pageParams(maxId?: string): HttpParams {
    let params = new HttpParams().set('limit', '20');
    if (maxId) {
      params = params.set('max_id', maxId);
    }
    return params;
  }
}
