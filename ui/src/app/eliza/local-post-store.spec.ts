import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalPostStore } from './local-post-store';
import { LocalNotificationStore } from './local-notification-store';
import { Auth } from '../auth';
import { LOCAL_POST_DISCLAIMER } from './eliza-content';
import { ELIZA_ID } from './eliza-identity';

describe('LocalPostStore', () => {
  let store: LocalPostStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    // An identity to author posts with — anonymous is the primary audience.
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    store = TestBed.inject(LocalPostStore);
  });

  it('starts empty', () => {
    expect(store.posts()).toEqual([]);
  });

  it('compose stores the post and an Eliza reply with the disclaimer', () => {
    const mine = store.compose('hello world');
    expect(mine).not.toBeNull();

    const posts = store.posts();
    expect(posts.length).toBe(2);

    const reply = posts.find((p) => p.account.id === ELIZA_ID);
    expect(reply).toBeDefined();
    expect(reply!.in_reply_to_id).toBe(mine!.id);
    // The disclaimer is present, though rendered as HTML (apostrophe escaped).
    expect(reply!.content).toContain('Remember, this doesn');
    expect(LOCAL_POST_DISCLAIMER).toContain('doesn');
  });

  it("the viewer's post uses a local: id, the reply uses an eliza: id", () => {
    const mine = store.compose('practice');
    const reply = store.posts().find((p) => p.id !== mine!.id);
    expect(mine!.id.startsWith('local:')).toBe(true);
    expect(reply!.id.startsWith('eliza:')).toBe(true);
  });

  it('reply threads under the target and also draws an Eliza answer', () => {
    const mine = store.reply('eliza:post:welcome', 'nice to meet you');
    expect(mine!.in_reply_to_id).toBe('eliza:post:welcome');

    const answer = store.posts().find((p) => p.in_reply_to_id === mine!.id);
    expect(answer?.account.id).toBe(ELIZA_ID);
  });

  it('ignores blank input', () => {
    expect(store.compose('   ')).toBeNull();
    expect(store.posts()).toEqual([]);
  });

  it("Eliza's reply to a local post posts a reply notification", () => {
    const notifs = TestBed.inject(LocalNotificationStore);
    store.compose('hello');
    const replies = notifs.items().filter((n) => n.kind === 'reply');
    expect(replies.length).toBe(1);
    expect(replies[0].link).toBe('/home');
  });

  it('persists across a refresh (localStorage)', () => {
    store.compose('remember me');
    const fresh = TestBed.inject(LocalPostStore);
    fresh.refresh();
    expect(fresh.posts().length).toBe(2);
  });

  it('delete removes a post and its replies', () => {
    const mine = store.compose('delete me');
    expect(store.posts().length).toBe(2);
    store.delete(mine!.id);
    expect(store.posts().length).toBe(0);
  });

  it('sorts newest first', () => {
    store.compose('first');
    store.compose('second');
    const times = store.posts().map((p) => Date.parse(p.created_at));
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });
});
