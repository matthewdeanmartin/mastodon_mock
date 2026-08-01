import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { Account } from '../../models';
import { Server } from '../../server';
import { MAWKINGBIRD_URL } from '../../invites/invite-templates';
import { Invites } from './invites';

const ACCOUNT = {
  id: '1',
  username: 'matt',
  acct: 'matt',
  display_name: 'Matt',
  url: 'https://example.social/@matt',
} as Account;

describe('Invites', () => {
  let account: WritableSignal<Account | null>;
  let baseUrl: WritableSignal<string>;
  let isAnonymous: boolean;

  function setUp(): ComponentFixture<Invites> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: Auth,
          useValue: {
            account,
            get isAnonymous() {
              return isAnonymous;
            },
          },
        },
        { provide: Server, useValue: { baseUrl } },
      ],
    });
    const fixture = TestBed.createComponent(Invites);
    fixture.detectChanges();
    return fixture;
  }

  function root(fixture: ComponentFixture<Invites>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function cards(fixture: ComponentFixture<Invites>): HTMLLIElement[] {
    return Array.from(root(fixture).querySelectorAll<HTMLLIElement>('li.invite-card'));
  }

  function boxes(fixture: ComponentFixture<Invites>): HTMLTextAreaElement[] {
    return Array.from(root(fixture).querySelectorAll<HTMLTextAreaElement>('textarea.invite-text'));
  }

  function tab(fixture: ComponentFixture<Invites>, label: string): HTMLButtonElement {
    return Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('button.tab')).find(
      (button) => button.textContent?.includes(label),
    )!;
  }

  function intentUrls(fixture: ComponentFixture<Invites>): string[] {
    return Array.from(root(fixture).querySelectorAll<HTMLAnchorElement>('a.btn')).map(
      (anchor) => anchor.getAttribute('href') ?? '',
    );
  }

  beforeEach(() => {
    localStorage.clear();
    account = signal<Account | null>(ACCOUNT);
    baseUrl = signal('https://example.social');
    isAnonymous = false;
  });

  it('shows ten Twitter invitations, each with the text visible and a composer link', () => {
    const fixture = setUp();
    expect(cards(fixture)).toHaveLength(10);
    expect(boxes(fixture)).toHaveLength(10);
    for (const url of intentUrls(fixture)) {
      expect(url).toContain('https://x.com/intent/post?text=');
    }
  });

  it('switches to a distinct set of Bluesky invitations', () => {
    const fixture = setUp();
    const xText = boxes(fixture)
      .map((box) => box.value)
      .join('\n');

    tab(fixture, 'Bluesky').click();
    fixture.detectChanges();

    const bskyText = boxes(fixture)
      .map((box) => box.value)
      .join('\n');
    expect(bskyText).not.toBe(xText);
    expect(cards(fixture).length).toBeGreaterThanOrEqual(6);
    for (const url of intentUrls(fixture)) {
      expect(url).toContain('https://bsky.app/intent/compose?text=');
    }
  });

  it('points Bluesky readers at an anonymous session on the sender’s own server', () => {
    account.set({ ...ACCOUNT, acct: 'matt@elekk.xyz' } as Account);
    const fixture = setUp();
    tab(fixture, 'Bluesky').click();
    fixture.detectChanges();

    const text = boxes(fixture)
      .map((box) => box.value)
      .join('\n');
    expect(text).toContain(`${MAWKINGBIRD_URL}/anonymous?elekk.xyz`);
    // Never the running deployment's own origin — this text is going somewhere else.
    expect(text).not.toContain('localhost');
  });

  it('includes the profile by default when there is one, and drops the line when turned off', () => {
    const fixture = setUp();
    const toggle = root(fixture).querySelector<HTMLInputElement>('.profile-toggle input')!;
    expect(toggle.checked).toBe(true);
    expect(boxes(fixture).some((box) => box.value.includes('https://example.social/@matt'))).toBe(
      true,
    );

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const text = boxes(fixture)
      .map((box) => box.value)
      .join('\n');
    expect(text).not.toContain('https://example.social/@matt');
    expect(text).not.toContain('Follow me at');
    expect(text).not.toContain('{');
  });

  it('picks the profile up when the account request lands after the page renders', () => {
    // Auth.account() is filled in by a request in flight while this page mounts,
    // so a default read once at init leaves the profile out of everything.
    account.set(null);
    const fixture = setUp();
    expect(boxes(fixture).join('')).not.toContain('example.social/@matt');

    account.set(ACCOUNT);
    fixture.detectChanges();

    const toggle = root(fixture).querySelector<HTMLInputElement>('.profile-toggle input')!;
    expect(toggle.checked).toBe(true);
    expect(boxes(fixture).some((box) => box.value.includes('https://example.social/@matt'))).toBe(
      true,
    );
  });

  it('offers nothing personal for the Anonymous account, and no placeholder either', () => {
    isAnonymous = true;
    account.set({ ...ACCOUNT, acct: 'mastodon.social', url: '' } as Account);
    baseUrl.set('https://mastodon.social');
    const fixture = setUp();

    const toggle = root(fixture).querySelector<HTMLInputElement>('.profile-toggle input')!;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    for (const box of boxes(fixture)) {
      expect(box.value).not.toContain('{');
    }
  });

  it('sends the edited text to the composer, not the original', () => {
    const fixture = setUp();
    const box = boxes(fixture)[0];
    box.value = 'my own words #Mastodon #Fediverse';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(intentUrls(fixture)[0]).toBe(
      `https://x.com/intent/post?text=${encodeURIComponent('my own words #Mastodon #Fediverse').replace(/%20/g, '+')}`,
    );
  });

  it('can put an edited card back to the original wording', () => {
    const fixture = setUp();
    const original = boxes(fixture)[0].value;
    const box = boxes(fixture)[0];
    box.value = 'scribbled over';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const reset: HTMLButtonElement = cards(fixture)[0].querySelector('button.link')!;
    reset.click();
    fixture.detectChanges();

    expect(boxes(fixture)[0].value).toBe(original);
  });

  it('warns when an edit runs past the composer limit, in words as well as colour', () => {
    const fixture = setUp();
    const box = boxes(fixture)[0];
    box.value = 'x'.repeat(281);
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const card = cards(fixture)[0];
    expect(card.querySelector('.count')!.textContent).toContain('281/280');
    expect(card.querySelector('.warn')!.textContent).toContain('Longer than Twitter');
    // Still openable — the composer is the final authority on length.
    expect(card.querySelector('a.btn')!.getAttribute('href')).toContain('x.com/intent/post');
  });

  it('rotates a different invitation to the top when shuffled', () => {
    const fixture = setUp();
    const first = cards(fixture)[0].querySelector('h2')!.textContent;
    const second = cards(fixture)[1].querySelector('h2')!.textContent;

    root(fixture).querySelector<HTMLButtonElement>('.invite-intro button')!.click();
    fixture.detectChanges();

    expect(cards(fixture)[0].querySelector('h2')!.textContent).toBe(second);
    expect(cards(fixture).map((card) => card.querySelector('h2')!.textContent)).toContain(first);
  });

  it('labels each composer link with the card title, not just an icon', () => {
    const fixture = setUp();
    const label = cards(fixture)[0].querySelector('a.btn')!.getAttribute('aria-label');
    const title = cards(fixture)[0].querySelector('h2')!.textContent;
    expect(label).toBe(`Post “${title}” on Twitter`);
  });

  it('copies exactly what the card shows', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = setUp();
    const shown = boxes(fixture)[0].value;

    cards(fixture)[0].querySelectorAll<HTMLButtonElement>('button')[0].click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith(shown);
    expect(cards(fixture)[0].textContent).toContain('Invitation copied');
  });

  it('falls back to a selectable dialog when the clipboard is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const fixture = setUp();
    const shown = boxes(fixture)[0].value;

    cards(fixture)[0].querySelectorAll<HTMLButtonElement>('button')[0].click();
    await fixture.whenStable();
    fixture.detectChanges();

    const dialog = root(fixture).querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector('textarea')!.value).toBe(shown);
  });
});
