import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account, Collection, Context, SearchResults, Status } from '../../models';
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

  it('loads public account collections from the source instance', () => {
    let received: Collection[] = [];
    api
      .getAccountCollections({ server: 'https://social.example', id: '7' })
      .subscribe((collections) => (received = collections));

    http.expectOne('https://social.example/api/v1/accounts/7/collections').flush({
      collections: [{ id: 'c1', name: 'Creators', item_count: 4 }],
    });

    expect(received).toEqual([{ id: 'c1', name: 'Creators', item_count: 4 }]);
  });

  it('loads and adapts a public hashtag timeline with native-id pagination', () => {
    let received: Status[] = [];
    api
      .getTagTimeline('https://social.example', 'cats', '80')
      .subscribe((statuses) => (received = statuses));

    const request = http.expectOne(
      (candidate) => candidate.url === 'https://social.example/api/v1/timelines/tag/cats',
    );
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('max_id')).toBe('80');
    request.flush([status('79')]);

    expect(received[0].provider).toBe('anonymous-mastodon');
    expect(received[0].providerRef).toEqual({
      server: 'https://social.example',
      statusId: '79',
      accountId: '7',
    });
  });

  it('approximates anonymous post search by merging each query-word hashtag timeline', () => {
    let received: SearchResults | undefined;
    api
      .searchPostsByHashtags('https://social.example', 'Cats, DOGS cats')
      .subscribe((results) => (received = results));

    const cats = http.expectOne('https://social.example/api/v1/timelines/tag/cats?limit=20');
    const dogs = http.expectOne('https://social.example/api/v1/timelines/tag/dogs?limit=20');
    cats.flush([status('10')]);
    dogs.flush([status('10'), status('11')]);

    expect(received?.statuses.map((item) => item.providerRef)).toEqual([
      { server: 'https://social.example', statusId: '10', accountId: '7' },
      { server: 'https://social.example', statusId: '11', accountId: '7' },
    ]);
    expect(received?.hashtags.map((tag) => tag.name)).toEqual(['cats', 'dogs']);
    http.expectNone((request) => request.url.includes('/api/v2/search'));
  });

  it('adapts anonymous search results to stable public source references', () => {
    let received: Status[] = [];
    api.search('https://social.example', 'cats', 'statuses').subscribe((results) => {
      received = results.statuses;
    });

    const request = http.expectOne(
      (candidate) =>
        candidate.url === 'https://social.example/api/v2/search' &&
        candidate.params.get('type') === 'statuses',
    );
    request.flush({ accounts: [account()], statuses: [status('10')], hashtags: [] });

    expect(received[0].id).toBe('anonymous-mastodon:social.example:10');
  });
});
