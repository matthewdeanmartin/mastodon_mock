import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Server } from '../../../../server';
import { ConnectionDoctorPage } from './connection-doctor-page';
import { PROBE_TARGETS } from './connection-doctor-catalog';

describe('ConnectionDoctorPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setUp(): ComponentFixture<ConnectionDoctorPage> {
    const fixture = TestBed.createComponent(ConnectionDoctorPage);
    fixture.detectChanges();
    return fixture;
  }

  function el(fixture: ComponentFixture<ConnectionDoctorPage>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function rows(fixture: ComponentFixture<ConnectionDoctorPage>): HTMLElement[] {
    return [...el(fixture).querySelectorAll<HTMLElement>('.doc-row')];
  }

  function rowFor(fixture: ComponentFixture<ConnectionDoctorPage>, host: string): HTMLElement {
    return rows(fixture).find((row) => row.textContent?.includes(host))!;
  }

  async function check(fixture: ComponentFixture<ConnectionDoctorPage>): Promise<void> {
    el(fixture).querySelector<HTMLButtonElement>('.doc-run button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lists every host before anything has been checked', () => {
    const fixture = setUp();
    // The list is the point even unchecked: it is also the answer to "what
    // does this app talk to?".
    expect(rows(fixture)).toHaveLength(PROBE_TARGETS.length);
    expect(el(fixture).textContent).toContain('Not checked');
  });

  it('includes the Mastodon server you are actually on', () => {
    TestBed.inject(Server).setBaseUrl('https://mastodon.social');
    const fixture = setUp();

    expect(rows(fixture)).toHaveLength(PROBE_TARGETS.length + 1);
    expect(rowFor(fixture, 'mastodon.social').textContent).toContain('Your Mastodon server');
  });

  it('checks every host and reports each verdict', async () => {
    const fixture = setUp();
    await check(fixture);

    expect(fetchMock).toHaveBeenCalledTimes(PROBE_TARGETS.length);
    expect(rowFor(fixture, 'openrouter.ai').textContent).toContain('Reachable');
    expect(el(fixture).textContent).toContain(`${PROBE_TARGETS.length} reachable, 0 blocked`);
  });

  it('offers the tab test only for hosts that failed', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('openrouter.ai')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response()),
    );
    const fixture = setUp();
    await check(fixture);

    // A green row has nothing left to diagnose; offering the follow-up there
    // would just be noise on fifteen rows.
    expect(rowFor(fixture, 'openrouter.ai').textContent).toContain('Open openrouter.ai in a tab');
    expect(rowFor(fixture, 'api.github.com').textContent).not.toContain('in a tab');
  });

  it('interprets the JS verdict together with what the user saw', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('openrouter.ai')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response()),
    );
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);

    const fixture = setUp();
    await check(fixture);

    const row = rowFor(fixture, 'openrouter.ai');
    row.querySelector<HTMLButtonElement>('.doc-followup button')!.click();
    fixture.detectChanges();

    // Handing a possibly hostile intermediary a handle on the app is a poor
    // trade for a diagnostic tab.
    expect(openSpy).toHaveBeenCalledWith('https://openrouter.ai', '_blank', 'noopener,noreferrer');

    const loaded = [
      ...rowFor(fixture, 'openrouter.ai').querySelectorAll<HTMLInputElement>('.doc-report input'),
    ].find((input) => input.value === 'loaded')!;
    loaded.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // The payoff: page loads + request fails rules the network out entirely.
    const reading = rowFor(fixture, 'openrouter.ai').querySelector('.doc-interpretation');
    expect(reading?.textContent).toContain('CORS');
  });

  it('warns that nothing is trustworthy when the control host fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const fixture = setUp();
    await check(fixture);

    expect(el(fixture).querySelector('.doc-control-warning')?.textContent).toContain('offline');
  });

  it('does not warn about the control when only one host is blocked', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('openrouter.ai')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response()),
    );
    const fixture = setUp();
    await check(fixture);

    expect(el(fixture).querySelector('.doc-control-warning')).toBeNull();
  });

  it('drops stale reports when the sweep is re-run', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('open', vi.fn());
    const fixture = setUp();
    await check(fixture);

    const row = rowFor(fixture, 'openrouter.ai');
    row.querySelector<HTMLButtonElement>('.doc-followup button')!.click();
    fixture.detectChanges();
    [...rowFor(fixture, 'openrouter.ai').querySelectorAll<HTMLInputElement>('.doc-report input')]
      .find((input) => input.value === 'block-page')!
      .dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(rowFor(fixture, 'openrouter.ai').querySelector('.doc-interpretation')).not.toBeNull();

    // An observation of the last sweep paired with a fresh verdict would state
    // a conclusion supported by neither.
    await check(fixture);
    expect(rowFor(fixture, 'openrouter.ai').querySelector('.doc-interpretation')).toBeNull();
  });
});
