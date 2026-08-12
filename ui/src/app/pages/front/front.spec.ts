import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { Server } from '../../server';
import { BUNDLED_STARTER_KITS } from '../../bundled-starter-kits.generated';
import { FrontPage } from './front';

const WITHHELD_KITS = ['war-in-ukraine', 'canadian-politics'];

/**
 * Accounts that appear *only* in the withheld kits.
 *
 * Deliberately not "every account in a withheld kit": one account
 * (heliomass@cosocial.ca) belongs to both `canadian-politics` and
 * `retro-computing`, and drawing it as a retro-computing account is fine. The
 * exclusion is about not framing the landing page around war or partisan
 * politics — it is not a blocklist of people, and treating it as one would make
 * the rule depend on who else happens to share a kit.
 */
const EXCLUSIVELY_WITHHELD_HANDLES = (() => {
  const inWithheld = new Set<string>();
  const inAllowed = new Set<string>();
  for (const kit of BUNDLED_STARTER_KITS) {
    for (const account of kit.accounts) {
      (WITHHELD_KITS.includes(kit.slug) ? inWithheld : inAllowed).add(account.acct);
    }
  }
  return new Set([...inWithheld].filter((acct) => !inAllowed.has(acct)));
})();

describe('FrontPage', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [Auth, Server, provideRouter([])] });
  });

  /**
   * Exit criterion 2. The faces are compiled in, so the page must paint without
   * touching the network — it has to survive every public server being down, and
   * it must never show a spinner where the pitch goes.
   */
  it('paints real accounts with no network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const fixture = TestBed.createComponent(FrontPage);
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.face-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('offers both doors above the fold', () => {
    const fixture = TestBed.createComponent(FrontPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a[href="/login"]')).toBeTruthy();
    expect(el.querySelector('button.door-primary')).toBeTruthy();
  });

  /** The whole point of the sprint: no server combo at the front door. */
  it('shows no server picker', () => {
    const fixture = TestBed.createComponent(FrontPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-server-discovery')).toBeNull();
    expect(el.querySelector('input[type="text"]')).toBeNull();
  });

  /**
   * Exit criterion 9. An editorial call about a landing page: the pitch is an
   * emotional beat, and a visitor who has opted into nothing should not have it
   * opened on war coverage or one country's partisan politics.
   */
  it('never draws from the withheld kits', () => {
    expect(EXCLUSIVELY_WITHHELD_HANDLES.size).toBeGreaterThan(0); // guard against a vacuous pass

    // Many draws, because the selection is random — one pass proves little.
    for (let i = 0; i < 40; i++) {
      const fixture = TestBed.createComponent(FrontPage);
      fixture.detectChanges();
      const handles = Array.from(
        fixture.nativeElement.querySelectorAll('.face-handle') as NodeListOf<HTMLElement>,
      ).map((el) => el.textContent?.replace(/^@/, '').trim() ?? '');

      for (const handle of handles) {
        expect(EXCLUSIVELY_WITHHELD_HANDLES.has(handle)).toBe(false);
      }
      fixture.destroy();
    }
  });

  /**
   * A module-scope draw is evaluated once per bundle load, which in a SPA means
   * the same faces forever. Drawing per construction is what makes the page feel
   * broader than it is.
   */
  it('draws different faces for different visits', () => {
    const draw = (): string => {
      const fixture = TestBed.createComponent(FrontPage);
      fixture.detectChanges();
      const handles = Array.from(
        fixture.nativeElement.querySelectorAll('.face-handle') as NodeListOf<HTMLElement>,
      )
        .map((el) => el.textContent?.trim() ?? '')
        .join('|');
      fixture.destroy();
      return handles;
    };

    const draws = new Set([draw(), draw(), draw(), draw(), draw()]);
    expect(draws.size).toBeGreaterThan(1);
  });

  /**
   * Exit criterion 10. Avatars are remote URLs on hosts a content blocker will
   * refuse; a blocked avatar is expected traffic, not an error. The failure must
   * degrade to an initial rather than leaving broken images under the pitch.
   */
  it('falls back to an initial when an avatar is blocked', () => {
    const fixture = TestBed.createComponent(FrontPage);
    fixture.detectChanges();

    const images = fixture.nativeElement.querySelectorAll(
      'img.face-avatar',
    ) as NodeListOf<HTMLImageElement>;
    expect(images.length).toBeGreaterThan(0);

    // Fail every avatar, as a blocker would.
    images.forEach((img) => img.dispatchEvent(new Event('error')));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('img.face-avatar').length).toBe(0);
    const fallbacks = fixture.nativeElement.querySelectorAll('.face-avatar-fallback');
    expect(fallbacks.length).toBe(images.length);
    expect((fallbacks[0] as HTMLElement).textContent?.trim()).toMatch(/\S/);
  });

  /**
   * Exit criterion 3, and the worst outcome this sprint could produce: showing a
   * returning user the marketing page reads as "the app logged me out".
   */
  it('sends a signed-in Mastodon user straight to Home', () => {
    TestBed.inject(Auth).setToken('a-token');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(FrontPage).detectChanges();

    expect(navigate).toHaveBeenCalledWith('/home', { replaceUrl: true });
  });

  it('sends a returning Anonymous user straight to Home', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(FrontPage).detectChanges();

    expect(navigate).toHaveBeenCalledWith('/home', { replaceUrl: true });
  });

  /** Exit criterion 4: one click, no questions asked. */
  it('enters Anonymous and goes Home on the primary button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ title: 'Mastodon' }) }),
    );
    const auth = TestBed.inject(Auth);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(FrontPage);
    fixture.detectChanges();
    await fixture.componentInstance.continueWithoutLoggingIn();

    expect(auth.isAnonymous).toBe(true);
    expect(TestBed.inject(Server).baseUrl()).toBe('https://mastodon.social');
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  /**
   * Exit criterion 5. The picker is gone from the front door, so the page owns
   * the fallback: a stranger cannot be asked to have an opinion about which
   * Mastodon server to read when the first choice is down.
   */
  it('falls through to another server when the first is unreachable', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) =>
      url.startsWith('https://mastodon.social')
        ? Promise.reject(new Error('blocked'))
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ title: 'Mas.to' }) }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const auth = TestBed.inject(Auth);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(FrontPage);
    fixture.detectChanges();
    await fixture.componentInstance.continueWithoutLoggingIn();

    expect(auth.isAnonymous).toBe(true);
    expect(TestBed.inject(Server).baseUrl()).toBe('https://mas.to');
  });

  it('explains itself when no server can be reached at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const auth = TestBed.inject(Auth);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(FrontPage);
    fixture.detectChanges();
    await fixture.componentInstance.continueWithoutLoggingIn();
    fixture.detectChanges();

    expect(auth.isAuthenticated).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.front-error')?.textContent).toContain(
      'Could not reach a public server',
    );
  });

  /**
   * Moved here from the login page, keeping its reasoning: the person most
   * likely to want this switch is the one who has not signed in yet, and they
   * should not have to create an account to find it.
   */
  it('carries the analytics opt-out', () => {
    const fixture = TestBed.createComponent(FrontPage);
    fixture.detectChanges();

    const box = fixture.nativeElement.querySelector(
      'input[name="analytics"]',
    ) as HTMLInputElement | null;
    expect(box).toBeTruthy();
    expect(box!.type).toBe('checkbox');
  });
});
