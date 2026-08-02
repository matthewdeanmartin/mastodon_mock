import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from './auth';
import { ClientPrefs } from './client-prefs';
import {
  accountIsOnServer,
  JustMyServer,
  normalizeInstanceHost,
  serverOnlyStatuses,
} from './just-my-server';
import { Account, Status } from './models';
import { AnonymousFollows } from './providers/anonymous/anonymous-follows';
import { AnonymousLists } from './providers/anonymous/anonymous-lists';
import { Server } from './server';

function account(id: string, host: string): Account {
  return {
    id,
    username: id,
    acct: `${id}@${host}`,
    display_name: id,
    note: '',
    url: `https://${host}/@${id}`,
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    fields: [],
  };
}

function status(id: string, author: Account, reblog: Status | null = null): Status {
  return {
    id,
    created_at: '2026-08-02T12:00:00Z',
    edited_at: null,
    content: id,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: author,
    reblog,
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

describe('JustMyServer helpers', () => {
  it('normalizes schemes, case, trailing dots, paths, and local ports', () => {
    expect(normalizeInstanceHost('HTTPS://Example.COM./about/')).toBe('example.com');
    expect(normalizeInstanceHost('localhost:3000')).toBe('localhost:3000');
  });

  it('recognizes bare Mastodon accounts as local', () => {
    const local = { ...account('local', 'example.com'), acct: 'local' };
    expect(accountIsOnServer(local, 'EXAMPLE.com.')).toBe(true);
    expect(accountIsOnServer(account('remote', 'elsewhere.social'), 'example.com')).toBe(false);
  });

  it('removes a local friend’s boost when the displayed author is remote', () => {
    const local = account('local', 'example.com');
    const localPost = status('local-post', local);
    const localBoost = status(
      'boost-local',
      local,
      status('remote-post', account('r', 'remote.tld')),
    );
    const kept = serverOnlyStatuses([localPost, localBoost], 'example.com');

    expect(kept.map((item) => item.id)).toEqual(['local-post']);
  });
});

describe('JustMyServer Anonymous list synchronization', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Auth).enterAnonymous('https://example.com');
  });

  it('creates the namespaced list and makes the switch available only after confirmation', async () => {
    const follows = TestBed.inject(AnonymousFollows);
    follows.follow(account('local', 'example.com'), 'https://example.com');
    follows.follow(account('remote', 'remote.tld'), 'https://example.com');
    const mode = TestBed.inject(JustMyServer);

    mode.checkList();
    expect(mode.ready()).toBe(false);
    mode.setEnabled(true);
    expect(mode.enabled()).toBe(false);

    await mode.prepareUpdate();
    expect(mode.plan()?.addIds).toHaveLength(1);
    expect(mode.plan()?.removeIds).toHaveLength(0);
    await mode.confirmUpdate();

    expect(mode.ready()).toBe(true);
    expect(TestBed.inject(AnonymousLists).lists()[0]?.title).toBe(
      'Mawingbird: People on example.com',
    );
    mode.setEnabled(true);
    expect(mode.effectiveEnabled()).toBe(true);
  });

  it('removes remote and stale members until only same-server friends remain', async () => {
    const follows = TestBed.inject(AnonymousFollows);
    follows.follow(account('local', 'example.com'), 'https://example.com');
    follows.follow(account('remote', 'remote.tld'), 'https://example.com');
    const lists = TestBed.inject(AnonymousLists);
    const list = lists.create('Mawingbird: People on example.com');
    lists.setMember(list.id, 'local@example.com', true);
    lists.setMember(list.id, 'remote@remote.tld', true);
    lists.setMember(list.id, 'gone@example.com', true);
    const mode = TestBed.inject(JustMyServer);

    await mode.prepareUpdate();
    expect(mode.plan()?.alreadyPresent).toBe(1);
    expect(mode.plan()?.removeIds.sort()).toEqual(['gone@example.com', 'remote@remote.tld']);
    await mode.confirmUpdate();

    expect(lists.get(list.id)?.memberKeys).toEqual(['local@example.com']);
    expect(mode.result()).toEqual({ added: 0, removed: 2, alreadyPresent: 1, failed: 0 });
  });
});

describe('JustMyServer signed-in list synchronization', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Server).setBaseUrl('https://example.com');
    const auth = TestBed.inject(Auth);
    auth.setToken('test-token');
    auth.setAccount({ ...account('me', 'example.com'), acct: 'me' });
  });

  it('fully synchronizes an existing Mastodon list in bounded membership batches', async () => {
    const mode = TestBed.inject(JustMyServer);
    mode.checkList();
    http
      .expectOne('/api/v1/lists')
      .flush([{ id: 'server-list', title: 'Mawingbird: People on example.com' }]);
    expect(mode.ready()).toBe(true);

    const preparing = mode.prepareUpdate();
    http
      .expectOne('/api/v1/lists')
      .flush([{ id: 'server-list', title: 'Mawingbird: People on example.com' }]);
    http
      .expectOne('/api/v1/accounts/me/following?limit=80')
      .flush([
        { ...account('local', 'example.com'), acct: 'local' },
        account('remote', 'remote.tld'),
      ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    http
      .expectOne('/api/v1/lists/server-list/accounts?limit=80')
      .flush([account('remote', 'remote.tld')]);
    await preparing;

    expect(mode.plan()).toMatchObject({
      addIds: ['local'],
      removeIds: ['remote'],
      alreadyPresent: 0,
    });

    const updating = mode.confirmUpdate();
    const remove = http.expectOne('/api/v1/lists/server-list/accounts');
    expect(remove.request.method).toBe('DELETE');
    expect(remove.request.body).toEqual({ account_ids: ['remote'] });
    remove.flush({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const add = http.expectOne('/api/v1/lists/server-list/accounts');
    expect(add.request.method).toBe('POST');
    expect(add.request.body).toEqual({ account_ids: ['local'] });
    add.flush({});
    await updating;

    expect(mode.ready()).toBe(true);
    expect(mode.result()).toEqual({ added: 1, removed: 1, alreadyPresent: 0, failed: 0 });

    TestBed.inject(ClientPrefs).setHomeWindow('all');
    mode.setEnabled(true);
    mode.resetFeed();
    const page = firstValueFrom(mode.nextPage());
    const local = { ...account('local', 'example.com'), acct: 'local' };
    http
      .expectOne('/api/v1/timelines/list/server-list?limit=20')
      .flush([
        status('local-post', local),
        status('remote-boost', local, status('remote-post', account('remote', 'remote.tld'))),
      ]);
    expect((await page).map((item) => item.id)).toEqual(['local-post']);
    http.verify();
  });
});
