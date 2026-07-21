import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElizaInbox } from './eliza-inbox';
import { ElizaService } from './eliza.service';
import { LocalNotificationStore } from './local-notification-store';

describe('ElizaInbox', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('redirects to her profile when not following', () => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(ElizaInbox).detectChanges();

    expect(nav).toHaveBeenCalledWith('/eliza');
  });

  it('marks notifications read when opened while following', () => {
    const eliza = TestBed.inject(ElizaService);
    const notifs = TestBed.inject(LocalNotificationStore);
    eliza.follow(); // adds the welcome (unread)
    notifs.push('reply', 'hi', '/home');
    expect(notifs.unread()).toBeGreaterThan(0);

    TestBed.createComponent(ElizaInbox).detectChanges();

    expect(notifs.unread()).toBe(0);
    // The items themselves are retained.
    expect(notifs.items().length).toBeGreaterThan(0);
  });

  it('maps kinds to icons', () => {
    TestBed.inject(ElizaService).follow();
    const cmp = TestBed.createComponent(ElizaInbox).componentInstance;
    expect(cmp.icon('message')).toBe('💬');
    expect(cmp.icon('reply')).toBe('↩️');
    expect(cmp.icon('welcome')).toBe('👋');
  });
});
