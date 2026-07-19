import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../../auth';
import { Account, Status } from '../../models';
import { AnonymousFollows } from './anonymous-follows';
import { AnonymousMastodonProvider } from './anonymous-mastodon-provider';
import { AnonymousTags } from './anonymous-tags';

function account(username: string, server: string, id = '1'): Account {
  return {
    id,
    username,
    acct: username,
    display_name: username,
    note: '',
    url: `${server}/@${username}`,
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

function status(author: Account, id = '10'): Status {
  return {
    id,
    created_at: '2026-07-19T12:00:00Z',
    edited_at: null,
    content: '<p>Hello</p>',
    spoiler_text: '',
    visibility: 'public',
    url: `${author.url}/${id}`,
    account: author,
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

describe('AnonymousMastodonProvider', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).enterAnonymous();
  });

  afterEach(() => httpMock.verify());

  it('looks up a followed account on its own instance and fetches public posts', () => {
    const server = 'https://social.example';
    const target = account('alice', server, 'remote-copy');
    TestBed.inject(AnonymousFollows).follow(target, 'https://mastodon.social');
    const provider = TestBed.inject(AnonymousMastodonProvider);
    provider.reset();
    let received: Status[] = [];

    provider.fetchPage().subscribe((items) => (received = items));

    const lookup = httpMock.expectOne(
      (request) => request.url === `${server}/api/v1/accounts/lookup`,
    );
    expect(lookup.request.params.get('acct')).toBe('alice');
    lookup.flush(account('alice', server, 'native-id'));
    const posts = httpMock.expectOne(
      `${server}/api/v1/accounts/native-id/statuses?limit=20&exclude_replies=true`,
    );
    posts.flush([status(account('alice', server, 'native-id'))]);

    expect(received).toHaveLength(1);
    expect(received[0].provider).toBe('anonymous-mastodon');
    expect(received[0].id).toBe('anonymous-mastodon:social.example:10');
    expect(received[0].account.acct).toBe('alice@social.example');
  });

  it('keeps successful sources when another followed instance fails', () => {
    const follows = TestBed.inject(AnonymousFollows);
    follows.follow(account('alice', 'https://one.example'), 'https://mastodon.social');
    follows.follow(account('bob', 'https://two.example'), 'https://mastodon.social');
    const provider = TestBed.inject(AnonymousMastodonProvider);
    provider.reset();
    let received: Status[] = [];

    provider.fetchPage().subscribe((items) => (received = items));
    httpMock
      .expectOne((request) => request.url === 'https://one.example/api/v1/accounts/lookup')
      .flush(account('alice', 'https://one.example', 'a1'));
    httpMock
      .expectOne((request) => request.url === 'https://two.example/api/v1/accounts/lookup')
      .flush(null, { status: 429, statusText: 'Limited' });
    httpMock
      .expectOne('https://two.example/@bob.rss')
      .flush(null, { status: 404, statusText: 'Missing' });
    httpMock
      .expectOne('https://one.example/api/v1/accounts/a1/statuses?limit=20&exclude_replies=true')
      .flush([status(account('alice', 'https://one.example', 'a1'))]);

    expect(received).toHaveLength(1);
    expect(provider.errors()).toEqual(['Could not load @bob@two.example.']);
  });

  it('keeps API posts when another follow fails both API and RSS CORS', () => {
    const follows = TestBed.inject(AnonymousFollows);
    follows.follow(account('alice', 'https://one.example'), 'https://mastodon.social');
    follows.follow(account('bob', 'https://two.example'), 'https://mastodon.social');
    const provider = TestBed.inject(AnonymousMastodonProvider);
    provider.reset();
    let received: Status[] = [];

    provider.fetchPage().subscribe((items) => (received = items));
    httpMock
      .expectOne((request) => request.url === 'https://one.example/api/v1/accounts/lookup')
      .flush(account('alice', 'https://one.example', 'a1'));
    httpMock
      .expectOne((request) => request.url === 'https://two.example/api/v1/accounts/lookup')
      .error(new ProgressEvent('error'));
    httpMock.expectOne('https://two.example/@bob.rss').error(new ProgressEvent('error'));
    httpMock
      .expectOne('https://one.example/api/v1/accounts/a1/statuses?limit=20&exclude_replies=true')
      .flush([status(account('alice', 'https://one.example', 'a1'))]);

    expect(received.map((item) => item.account.username)).toEqual(['alice']);
    expect(provider.errors()).toEqual(['Could not load @bob@two.example.']);

    // A manual refresh during the short backoff still loads healthy follows,
    // but does not immediately repeat Bob's doomed API + cross-origin RSS calls.
    provider.reset();
    received = [];
    provider.fetchPage().subscribe((items) => (received = items));
    httpMock
      .expectOne((request) => request.url === 'https://one.example/api/v1/accounts/a1/statuses')
      .flush([status(account('alice', 'https://one.example', 'a1'), '11')]);
    expect(received.map((item) => item.account.username)).toEqual(['alice']);
  });

  it('falls back to the public profile RSS feed after an anonymous API failure', () => {
    const follows = TestBed.inject(AnonymousFollows);
    follows.follow(account('alice', 'https://one.example'), 'https://mastodon.social');
    const provider = TestBed.inject(AnonymousMastodonProvider);
    provider.reset();
    let received: Status[] = [];

    provider.fetchPage().subscribe((items) => (received = items));
    httpMock
      .expectOne((request) => request.url === 'https://one.example/api/v1/accounts/lookup')
      .flush(null, { status: 429, statusText: 'Limited' });
    httpMock.expectOne('https://one.example/@alice.rss').flush(`
      <rss version="2.0"><channel><title>Alice</title><link>https://one.example/@alice</link>
      <item><guid>post-1</guid><title>Hello</title><link>https://one.example/@alice/1</link>
      <pubDate>Sun, 19 Jul 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>Hello</p>]]></description></item>
      </channel></rss>
    `);

    expect(received).toHaveLength(1);
    expect(received[0].provider).toBe('anonymous-mastodon');
    expect(received[0].account.acct).toBe('alice@one.example');
    expect(provider.errors()).toEqual(['Using RSS fallback for @alice@one.example.']);
  });

  it('fetches followed hashtag searches from the selected instance on demand', () => {
    TestBed.inject(AnonymousTags).follow('cats');
    const provider = TestBed.inject(AnonymousMastodonProvider);
    provider.reset();
    let received: Status[] = [];

    provider.fetchPage().subscribe((items) => (received = items));
    const request = httpMock.expectOne(
      (candidate) => candidate.url === 'https://mastodon.social/api/v1/timelines/tag/cats',
    );
    expect(request.request.params.get('limit')).toBe('20');
    request.flush([status(account('alice', 'https://mastodon.social'))]);

    expect(received).toHaveLength(1);
    expect(received[0].provider).toBe('anonymous-mastodon');
  });
});
