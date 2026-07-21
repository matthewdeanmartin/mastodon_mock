import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDmStore } from './local-dm-store';
import { LocalNotificationStore } from './local-notification-store';
import { ELIZA_FIRST_DM } from './eliza-content';

describe('LocalDmStore', () => {
  let dm: LocalDmStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    dm = TestBed.inject(LocalDmStore);
  });

  it('starts empty', () => {
    expect(dm.messages()).toEqual([]);
  });

  it('seeds exactly one opening message from Eliza', () => {
    dm.ensureSeeded();
    dm.ensureSeeded(); // idempotent
    const msgs = dm.messages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].from).toBe('eliza');
    expect(msgs[0].text).toBe(ELIZA_FIRST_DM);
  });

  it('send appends the viewer message then an Eliza reply', () => {
    dm.ensureSeeded();
    dm.send('hello');
    const msgs = dm.messages();
    expect(msgs.length).toBe(3);
    expect(msgs[1].from).toBe('me');
    expect(msgs[1].text).toBe('hello');
    expect(msgs[2].from).toBe('eliza');
    expect(msgs[2].text.length).toBeGreaterThan(0);
  });

  it('orders the reply after the viewer message', () => {
    dm.send('i am sad');
    const [mine, reply] = dm.messages();
    expect(Date.parse(reply.createdAt)).toBeGreaterThanOrEqual(Date.parse(mine.createdAt));
  });

  it('ignores blank sends', () => {
    dm.send('   ');
    expect(dm.messages()).toEqual([]);
  });

  it('a real send posts a message notification', () => {
    const notifs = TestBed.inject(LocalNotificationStore);
    dm.send('hello');
    const messages = notifs.items().filter((n) => n.kind === 'message');
    expect(messages.length).toBe(1);
    expect(messages[0].link).toBe('/eliza/chat');
  });

  it('persists across refresh, and re-seeding does not duplicate', () => {
    dm.ensureSeeded();
    dm.send('remember this');
    const fresh = TestBed.inject(LocalDmStore);
    fresh.refresh();
    expect(fresh.messages().length).toBe(3);
    fresh.ensureSeeded();
    expect(fresh.messages().length).toBe(3); // seed flag persisted
  });

  it('clear wipes the thread and the seed flag', () => {
    dm.ensureSeeded();
    dm.send('hi');
    dm.clear();
    expect(dm.messages()).toEqual([]);
    dm.ensureSeeded();
    expect(dm.messages().length).toBe(1); // seeds fresh again
  });
});
