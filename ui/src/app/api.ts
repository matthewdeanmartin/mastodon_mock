import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Account,
  Announcement,
  ComposeOptions,
  Context,
  Conversation,
  CustomEmoji,
  FeaturedTag,
  InstanceInfo,
  InstanceRule,
  TrendLink,
  MastodonNotification,
  MediaAttachment,
  OAuthApp,
  OAuthTokenResponse,
  Poll,
  Relationship,
  SearchResults,
  Status,
  StatusEdit,
  StatusSource,
  Tag,
  TermsOfService,
  Translation,
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

  postStatus(status: string, options: ComposeOptions = {}): Observable<Status> {
    // The backend accepts JSON for statuses, including a nested poll object and a
    // media_ids array, so a plain JSON body suffices (no `key[]` form encoding).
    const body: Record<string, unknown> = { status };
    if (options.inReplyToId) {
      body['in_reply_to_id'] = options.inReplyToId;
    }
    if (options.quotedStatusId) {
      body['quoted_status_id'] = options.quotedStatusId;
    }
    if (options.visibility) {
      body['visibility'] = options.visibility;
    }
    if (options.spoilerText) {
      body['spoiler_text'] = options.spoilerText;
    }
    if (options.sensitive) {
      body['sensitive'] = true;
    }
    if (options.mediaIds?.length) {
      body['media_ids'] = options.mediaIds;
    }
    if (options.poll) {
      body['poll'] = {
        options: options.poll.options,
        expires_in: options.poll.expiresIn,
        multiple: options.poll.multiple,
      };
    }
    return this.http.post<Status>('/api/v1/statuses', body);
  }

  // --- media ---
  uploadMedia(file: File, description?: string): Observable<MediaAttachment> {
    const form = new FormData();
    form.append('file', file);
    if (description?.trim()) {
      form.append('description', description.trim());
    }
    return this.http.post<MediaAttachment>('/api/v2/media', form);
  }

  updateMedia(id: string, description: string): Observable<MediaAttachment> {
    return this.http.put<MediaAttachment>(`/api/v1/media/${id}`, { description });
  }

  // --- polls ---
  votePoll(pollId: string, choices: number[]): Observable<Poll> {
    return this.http.post<Poll>(`/api/v1/polls/${pollId}/votes`, { choices });
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

  pin(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/pin`, {});
  }

  unpin(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/unpin`, {});
  }

  muteStatus(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/mute`, {});
  }

  unmuteStatus(id: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${id}/unmute`, {});
  }

  translate(id: string): Observable<Translation> {
    return this.http.post<Translation>(`/api/v1/statuses/${id}/translate`, {});
  }

  statusHistory(id: string): Observable<StatusEdit[]> {
    return this.http.get<StatusEdit[]>(`/api/v1/statuses/${id}/history`);
  }

  favouritedBy(id: string): Observable<Account[]> {
    return this.http.get<Account[]>(`/api/v1/statuses/${id}/favourited_by`);
  }

  rebloggedBy(id: string): Observable<Account[]> {
    return this.http.get<Account[]>(`/api/v1/statuses/${id}/reblogged_by`);
  }

  setInteractionPolicy(id: string, policy: string): Observable<Status> {
    return this.http.put<Status>(`/api/v1/statuses/${id}/interaction_policy`, {
      quote_approval_policy: policy,
    });
  }

  revokeQuote(quotedId: string, quotingId: string): Observable<Status> {
    return this.http.post<Status>(`/api/v1/statuses/${quotedId}/quotes/${quotingId}/revoke`, {});
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
    return this.http.get<Status[]>(`/api/v1/timelines/list/${id}`, {
      params: this.pageParams(maxId),
    });
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
  report(
    accountId: string,
    category: string,
    comment: string,
    statusIds?: string[],
  ): Observable<unknown> {
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

  // --- conversations (DMs) ---
  conversations(maxId?: string): Observable<Conversation[]> {
    return this.http.get<Conversation[]>('/api/v1/conversations', {
      params: this.pageParams(maxId),
    });
  }

  markConversationRead(id: string): Observable<Conversation> {
    return this.http.post<Conversation>(`/api/v1/conversations/${id}/read`, {});
  }

  // --- profile / settings ---
  updateCredentials(form: FormData): Observable<Account> {
    return this.http.patch<Account>('/api/v1/accounts/update_credentials', form);
  }

  mutes(): Observable<Account[]> {
    return this.http.get<Account[]>('/api/v1/mutes');
  }

  blocks(): Observable<Account[]> {
    return this.http.get<Account[]>('/api/v1/blocks');
  }

  unmuteAccount(id: string): Observable<Relationship> {
    return this.http.post<Relationship>(`/api/v1/accounts/${id}/unmute`, {});
  }

  block(id: string): Observable<Relationship> {
    return this.http.post<Relationship>(`/api/v1/accounts/${id}/block`, {});
  }

  unblockAccount(id: string): Observable<Relationship> {
    return this.http.post<Relationship>(`/api/v1/accounts/${id}/unblock`, {});
  }

  followRequests(): Observable<Account[]> {
    return this.http.get<Account[]>('/api/v1/follow_requests');
  }

  authorizeFollowRequest(id: string): Observable<Relationship> {
    return this.http.post<Relationship>(`/api/v1/follow_requests/${id}/authorize`, {});
  }

  rejectFollowRequest(id: string): Observable<Relationship> {
    return this.http.post<Relationship>(`/api/v1/follow_requests/${id}/reject`, {});
  }

  // --- tags ---
  getTag(name: string): Observable<Tag> {
    return this.http.get<Tag>(`/api/v1/tags/${encodeURIComponent(name)}`);
  }

  followTag(name: string): Observable<Tag> {
    return this.http.post<Tag>(`/api/v1/tags/${encodeURIComponent(name)}/follow`, {});
  }

  unfollowTag(name: string): Observable<Tag> {
    return this.http.post<Tag>(`/api/v1/tags/${encodeURIComponent(name)}/unfollow`, {});
  }

  featureTag(name: string): Observable<Tag> {
    return this.http.post<Tag>(`/api/v1/tags/${encodeURIComponent(name)}/feature`, {});
  }

  unfeatureTag(name: string): Observable<Tag> {
    return this.http.post<Tag>(`/api/v1/tags/${encodeURIComponent(name)}/unfeature`, {});
  }

  followedTags(): Observable<Tag[]> {
    return this.http.get<Tag[]>('/api/v1/followed_tags');
  }

  featuredTags(): Observable<FeaturedTag[]> {
    return this.http.get<FeaturedTag[]>('/api/v1/featured_tags');
  }

  // --- explore / discovery (anonymous-friendly) ---
  instanceInfo(): Observable<InstanceInfo> {
    return this.http.get<InstanceInfo>('/api/v2/instance');
  }

  trendingStatuses(): Observable<Status[]> {
    return this.http.get<Status[]>('/api/v1/trends/statuses');
  }

  trendingTags(): Observable<Tag[]> {
    return this.http.get<Tag[]>('/api/v1/trends/tags');
  }

  trendingLinks(): Observable<TrendLink[]> {
    return this.http.get<TrendLink[]>('/api/v1/trends/links');
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

  /**
   * Self-service signup. Needs an app token (client_credentials) so the call is
   * authenticated the way a real client would be; returns the new account's token.
   */
  register(
    appToken: string,
    body: { username: string; email: string; password: string; agreement: boolean },
  ): Observable<OAuthTokenResponse> {
    const form = new HttpParams()
      .set('username', body.username)
      .set('email', body.email)
      .set('password', body.password)
      .set('agreement', String(body.agreement));
    // Bypass the global interceptor's active token: registration uses the app token.
    return this.http.post<OAuthTokenResponse>('/api/v1/accounts', form, {
      headers: { Authorization: `Bearer ${appToken}` },
    });
  }

  /** Acquire an app-scoped token via the client_credentials grant. */
  clientCredentialsToken(clientId: string, clientSecret: string): Observable<OAuthTokenResponse> {
    const body = new HttpParams()
      .set('grant_type', 'client_credentials')
      .set('client_id', clientId)
      .set('client_secret', clientSecret)
      .set('scope', 'read write follow');
    return this.http.post<OAuthTokenResponse>('/oauth/token', body);
  }

  /** Exercise the email-confirmation endpoint (the mock accepts and no-ops). */
  confirmEmail(): Observable<unknown> {
    return this.http.post('/api/v1/emails/confirmations', {});
  }

  // --- full OAuth flow (alternative to dev-login) ---
  registerApp(
    clientName: string,
    redirectUri: string,
    scopes = 'read write follow',
  ): Observable<OAuthApp> {
    return this.http.post<OAuthApp>('/api/v1/apps', {
      client_name: clientName,
      redirect_uris: redirectUri,
      scopes,
    });
  }

  exchangeCode(params: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  }): Observable<OAuthTokenResponse> {
    const body = new HttpParams()
      .set('grant_type', 'authorization_code')
      .set('client_id', params.clientId)
      .set('client_secret', params.clientSecret)
      .set('redirect_uri', params.redirectUri)
      .set('code', params.code);
    return this.http.post<OAuthTokenResponse>('/oauth/token', body);
  }

  private pageParams(maxId?: string): HttpParams {
    let params = new HttpParams().set('limit', '20');
    if (maxId) {
      params = params.set('max_id', maxId);
    }
    return params;
  }
}
