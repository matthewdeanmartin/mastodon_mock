import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsShell } from './settings-shell';
import { Auth } from '../../auth';

describe('SettingsShell', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  it('renders the settings category sidebar', () => {
    const fixture = TestBed.createComponent(SettingsShell);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const labels = Array.from(el.querySelectorAll('.settings-nav a span:first-child')).map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).toContain('Public profile');
    expect(labels).toContain('Filters');
    expect(labels).toContain('Muted & Blocked');
    expect(labels).toContain('Posting & Privacy');
    expect(labels).not.toContain('Posting defaults');
    expect(labels).not.toContain('Blocked accounts');
    expect(labels).toContain('Approve follow requests');
    expect(labels).toContain('Import/Export Friends');
    expect(labels).toContain('Import/Export Config');
    // Mock build shows the _mock-backed pages too.
    expect(labels).toContain('Invite links');
  });

  it('shows only browser-local settings in Anonymous', () => {
    TestBed.inject(Auth).enterAnonymous();
    const fixture = TestBed.createComponent(SettingsShell);
    fixture.detectChanges();
    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.settings-nav a span:first-child'),
    ).map((node) => node.textContent?.trim());

    expect(labels).toEqual([
      'Public profile',
      'Server',
      'Mockingbird Blue',
      'Connections',
      'RSS feeds',
      // Anonymous-capable: a note can be a browser-local draft, so the PKM tag
      // vocabulary is configurable without a server identity.
      'Writing',
      'Appearance',
      'Internationalization',
      'Local storage',
      'Ads',
      'Signed-in accounts',
      // Trusted accounts and the CW/sensitive switches are client-side, so they
      // work anonymously even though 'Muted & Blocked' beside them does not.
      'Content warnings',
      'Import/Export Config',
      'Feature flags',
    ]);
  });

  it('does not show anonymous server settings for a signed-in account', () => {
    TestBed.inject(Auth).setToken('signed-in-token');
    const fixture = TestBed.createComponent(SettingsShell);
    fixture.detectChanges();
    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.settings-nav a span:first-child'),
    ).map((node) => node.textContent?.trim());

    expect(labels).not.toContain('Server');
  });
});
