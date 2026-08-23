import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../../auth';
import { FindFriends } from './find-friends';

/**
 * The page a stranger reaches in their first five minutes.
 *
 * What is asserted here is *order and grouping*, because that is the whole
 * change: every row on this page already worked, and the page still failed a new
 * visitor by leading with the options that need prior knowledge.
 */
describe('FindFriends', () => {
  let anonymous: boolean;

  function setUp(): ComponentFixture<FindFriends> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: Auth,
          useValue: {
            get isAnonymous() {
              return anonymous;
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(FindFriends);
    fixture.detectChanges();
    return fixture;
  }

  function rowTitles(fixture: ComponentFixture<FindFriends>): string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('.doc-title')].map(
      (el) => el.textContent?.trim() ?? '',
    );
  }

  beforeEach(() => {
    anonymous = true;
  });

  it('leads with starter kits, not with search', () => {
    // Starter kits are the only option that works with no name in mind and no
    // leaving the site. "Search for people" led before, which asks a brand-new
    // visitor to already know who they are looking for.
    expect(rowTitles(setUp())[0]).toBe('Starter kits');
  });

  it('puts everything needing prior knowledge under Advanced', () => {
    const fixture = setUp();
    const headings = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.ff-heading'),
    ].map((el) => el.textContent?.trim());
    expect(headings).toContain('Advanced');

    // Off-site directories are the clearest case: following someone found there
    // means reading a handle elsewhere, coming back, and searching by hand.
    const titles = rowTitles(fixture);
    const advancedStart = titles.indexOf('Search for people by name');
    expect(advancedStart).toBeGreaterThan(0);
    expect(titles.indexOf('Offsite directories')).toBeGreaterThan(advancedStart);
    // ...and starter kits stay above all of it.
    expect(titles.indexOf('Starter kits')).toBeLessThan(advancedStart);
  });

  it('offers interest links that run a post search', () => {
    // These answer "what would I even type", which is the question that stops
    // people at an empty search box. Plain links into /search, so there is no
    // second search implementation to keep working.
    const chips = [...(setUp().nativeElement as HTMLElement).querySelectorAll('.ff-interest')];

    expect(chips.length).toBeGreaterThan(4);
    const href = chips[0]?.getAttribute('href') ?? '';
    expect(href).toContain('/search');
    expect(href).toContain('type=statuses');
  });

  it('hides importing a follow list from anonymous visitors', () => {
    // An anonymous account has no follow list on a server to import into.
    expect(rowTitles(setUp())).not.toContain('Import a follow list');

    anonymous = false;
    expect(rowTitles(setUp())).toContain('Import a follow list');
  });
});
