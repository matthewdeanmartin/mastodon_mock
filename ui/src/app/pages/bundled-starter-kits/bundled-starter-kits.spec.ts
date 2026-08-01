import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { STARTER_COLLECTION } from '../../starter-collection';
import { BundledStarterKits } from './bundled-starter-kits';

describe('BundledStarterKits', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(BundledStarterKits);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('links the universal kit with its real member count', () => {
    const el = render();
    const row = el.querySelector('a.kit-row') as HTMLAnchorElement;

    expect(row.getAttribute('href')).toBe('/collections/starter');
    expect(row.textContent).toContain('Universal starter kit');
    expect(row.textContent).toContain(`${STARTER_COLLECTION.length} accounts`);
  });

  // These are ours, and the page must not imply otherwise — that is the whole
  // distinction from the bundled *collections* page next door.
  it('attributes the kits to this app rather than to the fediverse', () => {
    expect(render().textContent).toContain('developer of Mawkingbird');
  });
});
