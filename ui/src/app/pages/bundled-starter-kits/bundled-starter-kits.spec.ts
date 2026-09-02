import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { STARTER_COLLECTION, STARTER_KITS } from '../../starter-collection';
import { SHIPPED_STARTER_KITS } from '../../starter-kits';
import { BundledStarterKits } from './bundled-starter-kits';

/**
 * The page a first-run visitor is sent to. It used to be one of two — our
 * starter kits here, other people's collections at `/bundled-collections` —
 * which asked a newcomer to choose between two words before seeing a face.
 */
describe('BundledStarterKits', () => {
  let fixture: ComponentFixture<BundledStarterKits>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(BundledStarterKits);
    fixture.detectChanges();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function setFilter(value: string): void {
    (fixture.componentInstance as unknown as { filter: { set(v: string): void } }).filter.set(
      value,
    );
    fixture.detectChanges();
  }

  it('lists both kinds of curated set together', () => {
    const rows = el().querySelectorAll('.kit-row');

    expect(rows).toHaveLength(STARTER_KITS.length + SHIPPED_STARTER_KITS.length);
  });

  /**
   * Carried over from when this page listed only our own kits. The counts are
   * validated against the real snapshots, so a kit that silently lost members
   * shows up here rather than as a thin timeline for whoever follows it.
   */
  it('links every starter kit with its validated member count', () => {
    const rows = [...el().querySelectorAll<HTMLAnchorElement>('.kit-row')];

    for (const kit of STARTER_KITS) {
      const row = rows.find((r) => r.textContent?.includes(kit.title));
      expect(row, `no row for ${kit.title}`).toBeDefined();
      expect(row!.textContent).toContain(`${kit.accounts.length} accounts`);
      expect(row!.getAttribute('href')).toBe(
        kit.slug === 'starter' ? '/collections/starter' : `/collections/starter/${kit.slug}`,
      );
    }
  });

  it('links the universal kit at its own stable route', () => {
    const rows = [...el().querySelectorAll<HTMLAnchorElement>('.kit-row')];
    const universal = rows.find((r) => r.textContent?.includes('Universal starter kit'));

    expect(universal?.getAttribute('href')).toBe('/collections/starter');
    expect(universal?.textContent).toContain(`${STARTER_COLLECTION.length} accounts`);
  });

  it('names who curated a snapshotted collection, and marks our own as ours', () => {
    // Provenance is real and worth stating — it is just not a fork in the road.
    const text = el().textContent ?? '';
    const collection = SHIPPED_STARTER_KITS[0];

    expect(text).toContain(collection.title);
    expect(text).toContain(collection.curatorName || collection.curatorHandle);
    expect(text).toContain('Ours');
  });

  it('every row links somewhere that opens the set', () => {
    const links = [...el().querySelectorAll<HTMLAnchorElement>('.kit-row')];

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toContain('/collections');
    }
  });

  it('narrows the list to what the reader typed', () => {
    const collection = SHIPPED_STARTER_KITS[0];
    setFilter(collection.title);

    const rows = el().querySelectorAll('.kit-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(STARTER_KITS.length + SHIPPED_STARTER_KITS.length);
    expect(el().textContent).toContain(collection.title);
  });

  it('says so rather than going blank when nothing matches', () => {
    setFilter('zzzzz-no-such-set');

    expect(el().querySelectorAll('.kit-row')).toHaveLength(0);
    expect(el().textContent).toContain('Clear the filter');
  });

  /**
   * The power-user door. Someone who already has a timeline and wants more
   * people, tags, imports or directories wants the hub — but at the foot, not
   * in front of the faces a newcomer came for.
   */
  it('keeps a way through to the full set of finding tools', () => {
    const more = el().querySelector<HTMLAnchorElement>('.kit-more a');

    expect(more?.getAttribute('href')).toBe('/find-friends');
  });
});
