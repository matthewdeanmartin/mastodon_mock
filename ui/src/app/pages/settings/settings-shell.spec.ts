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
    expect(labels).toContain('Muted accounts');
    // Mock build shows the _mock-backed pages too.
    expect(labels).toContain('Invite people');
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
      'Anonymous',
      'Mockingbird Blue',
      'Connections',
      'Appearance',
      'Local storage',
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
