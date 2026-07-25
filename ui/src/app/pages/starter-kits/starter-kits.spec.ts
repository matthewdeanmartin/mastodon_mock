import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { Auth } from '../../auth';
import { StarterKits } from './starter-kits';

describe('StarterKits page', () => {
  it('shows the universal kit and every shipped kit to Anonymous users', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const fixture = TestBed.createComponent(StarterKits);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect((el.querySelector('.universal-kit') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/collections/starter',
    );
    expect(el.querySelectorAll('app-starter-kit-post')).toHaveLength(11);
    expect(el.textContent).toContain('Community starter kits');
  });
});
