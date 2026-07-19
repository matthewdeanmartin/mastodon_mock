import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account, Context, Status } from '../../models';
import { AnonymousPublicApi } from './anonymous-public-api';

function account(): Account {
  return {
    id: '7',
    username: 'alice',
    acct: 'alice',
    display_name: 'Alice',
    note: '',
    url: 'https://social.example/@alice',
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 1,
    bot: false,
    locked: false,
    fields: [],
  };
}

function status(id: string): Status {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: `https://social.example/@alice/${id}`,
    account: account(),
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
  };
}

describe('AnonymousPublicApi', () => {
  let http: HttpTestingController;
  let api: AnonymousPublicApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(AnonymousPublicApi);
  });

  afterEach(() => http.verify());

  it('loads and adapts a public status context from its source instance', () => {
    let received: Context | undefined;
    api
      .getContext({ server: 'https://social.example', id: '100' })
      .subscribe((value) => (received = value));

    http
      .expectOne('https://social.example/api/v1/statuses/100/context')
      .flush({ ancestors: [status('99')], descendants: [status('101')] });

    expect(received?.ancestors[0].id).toBe('anonymous-mastodon:social.example:99');
    expect(received?.descendants[0].providerRef).toEqual({
      server: 'https://social.example',
      statusId: '101',
      accountId: '7',
    });
  });

  it('passes profile paging filters to the public endpoint', () => {
    api
      .getAccountStatuses(
        { server: 'https://social.example', id: '7' },
        { excludeReplies: true, maxId: '80', limit: 20 },
      )
      .subscribe();

    const request = http.expectOne(
      (candidate) => candidate.url === 'https://social.example/api/v1/accounts/7/statuses',
    );
    expect(request.request.params.get('exclude_replies')).toBe('true');
    expect(request.request.params.get('max_id')).toBe('80');
    expect(request.request.params.get('limit')).toBe('20');
    request.flush([]);
  });
});
