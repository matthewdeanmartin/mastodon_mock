import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_STARTER_KITS } from '../../starter-kits';
import { BundledCollections } from './bundled-collections';

describe('BundledCollections', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(BundledCollections);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists every shipped collection', () => {
    const el = render();
    expect(el.querySelectorAll('app-starter-kit-post')).toHaveLength(SHIPPED_STARTER_KITS.length);
    expect(el.textContent).toContain('Artists of Mastodon');
  });

  // The page has to say what these are, because "bundled" alone reads as
  // something we made up rather than a snapshot of somebody's real collection.
  it('says these are real collections and why they ship with the app', () => {
    const text = render().textContent ?? '';
    expect(text).toContain('real collections');
    expect(text).toContain('search');
  });
});
