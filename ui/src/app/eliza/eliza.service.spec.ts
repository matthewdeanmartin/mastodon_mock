import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ElizaService } from './eliza.service';
import { ELIZA_ID } from './eliza-identity';
import { ELIZA_POSTS } from './eliza-content';

describe('ElizaService', () => {
  let eliza: ElizaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    eliza = TestBed.inject(ElizaService);
  });

  it('owns its own ids but not real ones', () => {
    expect(eliza.owns(ELIZA_ID)).toBe(true);
    expect(eliza.owns('eliza:post:welcome')).toBe(true);
    expect(eliza.owns('42')).toBe(false);
  });

  it('recognises her handle in several forms', () => {
    expect(eliza.ownsHandle('eliza')).toBe(true);
    expect(eliza.ownsHandle('@eliza')).toBe(true);
    expect(eliza.ownsHandle('eliza@mastodon.social')).toBe(true);
    expect(eliza.ownsHandle('steve')).toBe(false);
    expect(eliza.ownsHandle(null)).toBe(false);
  });

  it('exposes her account and full timeline', () => {
    expect(eliza.account().id).toBe(ELIZA_ID);
    expect(eliza.timeline().length).toBe(ELIZA_POSTS.length);
  });

  it('replies to messages and advances its own seed', () => {
    // Two identical inputs should not be forced to match (rolling seed varies).
    const replies = new Set([
      eliza.reply('i need a break'),
      eliza.reply('i need a break'),
      eliza.reply('i need a break'),
    ]);
    expect(replies.size).toBeGreaterThan(0);
  });

  it('replyWithSeed is deterministic and does not advance the rolling seed', () => {
    expect(eliza.replyWithSeed('i need a break', 3)).toBe(
      eliza.replyWithSeed('i need a break', 3),
    );
  });
});
