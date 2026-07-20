import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStorage } from './settings-storage';

describe('SettingsStorage', () => {
  let fixture: ComponentFixture<SettingsStorage>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mastodon_mock_account_mode', 'anonymous');
    localStorage.setItem('mockingbird_anonymous_follows', '[]');
    localStorage.setItem('mockingbird_rss_feeds_anonymous', '[]');
    localStorage.setItem('mockingbird_rss_feeds_other', '[]');
    localStorage.setItem('mastodon_mock_sessions', '[]');
    fixture = TestBed.createComponent(SettingsStorage);
    fixture.detectChanges();
  });

  it('shows only storage belonging to the active account', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('mockingbird_anonymous_follows');
    expect(text).toContain('mockingbird_rss_feeds_anonymous');
    expect(text).not.toContain('mockingbird_rss_feeds_other');
    expect(text).not.toContain('mastodon_mock_sessions');
  });

  it('deletes an individual account key', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[aria-label="Delete mockingbird_anonymous_follows"]')!
      .click();
    expect(localStorage.getItem('mockingbird_anonymous_follows')).toBeNull();
    expect(localStorage.getItem('mastodon_mock_sessions')).toBe('[]');
  });
});
