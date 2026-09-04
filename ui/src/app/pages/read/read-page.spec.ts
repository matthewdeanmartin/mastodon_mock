import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadPage } from './read-page';
import { ReaderCore } from './reader-core/reader-core';
import { ReadingZen } from '../../reading-zen';
import { ClientPrefs } from '../../client-prefs';
import { Status } from '../../models';

/**
 * The real `ReaderCore` is used, not a stub.
 *
 * `ReadPage` reaches it through `viewChild(ReaderCore)`, which matches by class
 * — a stub component with the same selector is simply never found, and every
 * keyboard test then passes vacuously against a null core. So the core is real
 * and its paging methods are spied on the found instance.
 *
 * It costs nothing here: with no article fetched the core renders a header and
 * a fetch button, and touches no network.
 */
function makeStatus(id: string): Status {
  return {
    id,
    content: '<p>A post long enough to be worth reading on its own terms.</p>',
    in_reply_to_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    account: { id: 'a', username: 'ann', acct: 'ann', display_name: 'Ann' },
    media_attachments: [],
    favourites_count: 0,
    reblogs_count: 0,
    replies_count: 0,
  } as unknown as Status;
}

let httpMock: HttpTestingController;

function setUp(id: string): ComponentFixture<ReadPage> {
  TestBed.overrideProvider(ActivatedRoute, {
    useValue: { paramMap: of(convertToParamMap({ id })) },
  });
  httpMock = TestBed.inject(HttpTestingController);
  // After the overrides: `TestBed.inject` instantiates the module, and an
  // override afterwards throws.
  TestBed.inject(ReadingZen).reset();
  const fixture = TestBed.createComponent(ReadPage);
  fixture.detectChanges();
  return fixture;
}

describe('ReadPage', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  it('loads the requested document and renders it', () => {
    const fixture = setUp('1');
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush({ ancestors: [], descendants: [] });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('app-reader-core')).not.toBeNull();
  });

  // ------------------------------------------------------------------- zen

  it('hides the rails AND the chrome while open', () => {
    const fixture = setUp('1');
    const zen = TestBed.inject(ReadingZen);
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush({ ancestors: [], descendants: [] });
    fixture.detectChanges();

    // Both, not just the rails: a book does not have the app's navigation
    // printed across the top of every page.
    expect(zen.active()).toBe(true);
    expect(zen.chromeHidden()).toBe(true);
  });

  it('gives the chrome back on destroy, not only on Exit', () => {
    // A browser Back never calls the Exit handler. Releasing there instead of
    // in ngOnDestroy leaks the hold and leaves an app with no navigation.
    const fixture = setUp('1');
    const zen = TestBed.inject(ReadingZen);
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush({ ancestors: [], descendants: [] });
    fixture.detectChanges();
    expect(zen.chromeHidden()).toBe(true);

    fixture.destroy();

    expect(zen.active()).toBe(false);
    expect(zen.chromeHidden()).toBe(false);
  });

  it('never writes the zen preference', () => {
    // The whole reason reading zen is a hold: writing prefs.setZenMode() would
    // persist, and exiting would switch zen *off* for someone who arrived with
    // it on. Visiting an article must not reconfigure the app.
    const fixture = setUp('1');
    const prefs = TestBed.inject(ClientPrefs);
    prefs.setZenMode(false);
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush({ ancestors: [], descendants: [] });
    fixture.detectChanges();
    fixture.destroy();

    expect(prefs.zenMode()).toBe(false);
  });

  // -------------------------------------------------------------- keyboard

  /** The rendered core, with its paging methods spied. */
  function spiedCore(fixture: ComponentFixture<ReadPage>, pages: number) {
    const found = fixture.debugElement.query(
      (node) => node.componentInstance instanceof ReaderCore,
    );
    expect(found, 'the reader core should be rendered').toBeTruthy();
    const core = found.componentInstance as ReaderCore;
    let page = 1;
    const next = vi.spyOn(core, 'nextPage').mockImplementation(() => {
      page = Math.min(pages, page + 1);
    });
    const prev = vi.spyOn(core, 'prevPage').mockImplementation(() => {
      page = Math.max(1, page - 1);
    });
    const goTo = vi.spyOn(core, 'goToPage').mockImplementation((n: number) => {
      page = Math.min(Math.max(1, n), pages);
    });
    return { next, prev, goTo, page: () => page };
  }

  function press(key: string, init: KeyboardEventInit = {}): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  }

  function loaded(): ComponentFixture<ReadPage> {
    const fixture = setUp('1');
    httpMock.expectOne('/api/v1/statuses/1').flush(makeStatus('1'));
    httpMock.expectOne('/api/v1/statuses/1/context').flush({ ancestors: [], descendants: [] });
    fixture.detectChanges();
    return fixture;
  }

  it('turns the page with the arrow keys', () => {
    const fixture = loaded();
    const core = spiedCore(fixture, 5);

    press('ArrowRight');
    expect(core.next).toHaveBeenCalled();

    press('ArrowLeft');
    expect(core.prev).toHaveBeenCalled();
  });

  it('space pages forward and shift+space back', () => {
    const fixture = loaded();
    const core = spiedCore(fixture, 5);

    press(' ');
    expect(core.next).toHaveBeenCalledTimes(1);

    press(' ', { shiftKey: true });
    expect(core.prev).toHaveBeenCalledTimes(1);
  });

  it('Home and End jump to the ends', () => {
    const fixture = loaded();
    const core = spiedCore(fixture, 12);

    press('End');
    expect(core.goTo).toHaveBeenCalled();
    expect(core.page()).toBe(12);

    press('Home');
    expect(core.page()).toBe(1);
  });

  it('leaves the keys alone while a modifier is held', () => {
    // ⌘← is "go back" on a Mac, and taking it would be a hostile surprise.
    const fixture = loaded();
    const core = spiedCore(fixture, 5);

    press('ArrowRight', { metaKey: true });
    press('ArrowLeft', { ctrlKey: true });

    expect(core.next).not.toHaveBeenCalled();
    expect(core.prev).not.toHaveBeenCalled();
  });

  it('does not page while typing in a form control', () => {
    const fixture = loaded();
    const core = spiedCore(fixture, 5);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    input.remove();

    expect(core.next).not.toHaveBeenCalled();
  });

  it('does not page in scroll mode, where there are no pages to turn', () => {
    const fixture = loaded();
    TestBed.inject(ClientPrefs).setReaderPageFlip(false);
    const core = spiedCore(fixture, 5);

    press('ArrowRight');

    expect(core.next).not.toHaveBeenCalled();
  });

  it('Escape leaves the reader, going back where there is somewhere to go', () => {
    const fixture = loaded();
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    // jsdom starts with a length of 1, which is the cold-open case; this test
    // is about the other one.
    const length = vi.spyOn(history, 'length', 'get').mockReturnValue(3);

    press('Escape');

    expect(back).toHaveBeenCalled();
    back.mockRestore();
    length.mockRestore();
    fixture.destroy();
  });

  it('falls back to the thread when there is no history to go back to', () => {
    // A shared link opened cold: Back would leave the app entirely, so Exit
    // has to name a destination instead.
    const fixture = loaded();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(history, 'length', 'get').mockReturnValue(1);

    press('Escape');

    expect(navigate).toHaveBeenCalledWith(['/statuses', '1'], { queryParams: { reader: '0' } });
    fixture.destroy();
  });
});
