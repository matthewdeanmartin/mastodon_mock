import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsShell } from './settings-shell';

describe('SettingsShell', () => {
  beforeEach(() => {
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
});
