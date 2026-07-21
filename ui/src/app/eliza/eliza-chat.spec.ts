import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElizaChat } from './eliza-chat';
import { ElizaService } from './eliza.service';
import { LocalDmStore } from './local-dm-store';
import { ELIZA_FIRST_DM } from './eliza-content';

describe('ElizaChat', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('redirects to her profile when not following', () => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(ElizaChat).detectChanges();

    expect(nav).toHaveBeenCalledWith('/eliza');
    // Not seeded — we bailed before opening the thread.
    expect(TestBed.inject(LocalDmStore).messages()).toEqual([]);
  });

  it('opens and seeds the thread when following', () => {
    TestBed.inject(ElizaService).follow();

    const fixture = TestBed.createComponent(ElizaChat);
    fixture.detectChanges();

    const msgs = TestBed.inject(LocalDmStore).messages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe(ELIZA_FIRST_DM);
  });

  it('sends a message and Eliza replies', () => {
    TestBed.inject(ElizaService).follow();
    const fixture = TestBed.createComponent(ElizaChat);
    fixture.detectChanges();

    const cmp = fixture.componentInstance as unknown as { draft: string; send(): void };
    cmp.draft = 'i am happy';
    cmp.send();

    const msgs = TestBed.inject(LocalDmStore).messages();
    // seed + mine + reply
    expect(msgs.length).toBe(3);
    expect(msgs[1].from).toBe('me');
    expect(msgs[2].from).toBe('eliza');
    expect(cmp.draft).toBe('');
  });
});
