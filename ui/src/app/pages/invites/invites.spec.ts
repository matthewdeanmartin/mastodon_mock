import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { JOIN_MASTODON_URL } from '../../invites/invite-templates';
import { Account } from '../../models';
import { Server } from '../../server';
import { Invites } from './invites';

const ACCOUNT = {
  id: '1',
  username: 'matt',
  acct: 'matt@example.social',
  display_name: 'Matt',
  url: 'https://example.social/@matt',
} as Account;

describe('Invites', () => {
  let account: WritableSignal<Account | null>;
  let baseUrl: WritableSignal<string>;
  let isAuthenticated: boolean;
  let isAnonymous: boolean;

  function setUp(): ComponentFixture<Invites> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: Auth,
          useValue: {
            account,
            get isAuthenticated() {
              return isAuthenticated;
            },
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

  beforeEach(() => {
    localStorage.clear();
    account = signal<Account | null>(ACCOUNT);
    baseUrl = signal('https://example.social');
    isAuthenticated = true;
    isAnonymous = false;
  });

  it('shows exactly two invitation choices with reasonable defaults in simple mode', () => {
    const fixture = setUp();

    expect(cards(fixture)).toHaveLength(2);
    expect(boxes(fixture).every((box) => box.value.includes(JOIN_MASTODON_URL))).toBe(true);
    expect(boxes(fixture).some((box) => box.value.includes(ACCOUNT.url))).toBe(true);
    expect(root(fixture).textContent).not.toContain('touch grass');
  });

  it('works signed out and explains the optional sign-in benefits', () => {
    isAuthenticated = false;
    account.set(null);
    baseUrl.set('');
    const fixture = setUp();

    expect(cards(fixture)).toHaveLength(2);
    expect(root(fixture).textContent).toContain('No account required.');
    expect(boxes(fixture).every((box) => !box.value.includes('{'))).toBe(true);
  });

  it('offers sign-in to the browser-local Anonymous account while using its API server', () => {
    isAuthenticated = true;
    isAnonymous = true;
    account.set(null);
    baseUrl.set('https://mastodon.social');
    const fixture = setUp();

    expect(root(fixture).textContent).toContain('No account required.');
    expect(root(fixture).textContent).toContain('Sign in');
    expect(root(fixture).textContent).toContain('mastodon.social');
  });

  it('reveals the humorous option and link controls only in advanced mode', () => {
    const fixture = setUp();
    const advanced = Array.from(
      root(fixture).querySelectorAll<HTMLButtonElement>('.mode-switch button'),
    ).find((button) => button.textContent?.includes('Advanced'))!;

    advanced.click();
    fixture.detectChanges();

    expect(cards(fixture)).toHaveLength(4);
    expect(root(fixture).textContent).toContain('Real talk: touch grass');
    expect(root(fixture).querySelector('#promotion-target')).toBeTruthy();
  });

  it('can promote the anonymous API server public homepage', () => {
    isAuthenticated = false;
    account.set(null);
    baseUrl.set('https://mstdn.social');
    const fixture = setUp();
    const advanced = root(fixture).querySelectorAll<HTMLButtonElement>('.mode-switch button')[1];
    advanced.click();
    fixture.detectChanges();

    const select = root(fixture).querySelector<HTMLSelectElement>('#promotion-target')!;
    select.value = 'home-server';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(boxes(fixture).every((box) => box.value.includes('https://mstdn.social'))).toBe(true);
  });

  it('uses Mastodon sharing only for the rally message', () => {
    const fixture = setUp();
    const directLinks = Array.from(
      root(fixture).querySelectorAll<HTMLAnchorElement>('.invite-card a.btn'),
    );
    expect(directLinks.every((link) => !link.href.includes('/share?'))).toBe(true);

    const rally = root(fixture).querySelector<HTMLAnchorElement>('.rally-card a.btn')!;
    expect(rally.href).toContain('https://example.social/share?text=');
    expect(decodeURIComponent(rally.href)).toContain('got+friends+still+on+Twitter');
  });

  it('sends hand-edited text to both external composers', () => {
    const fixture = setUp();
    const box = boxes(fixture)[0];
    box.value = 'my own invitation';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const links = cards(fixture)[0].querySelectorAll<HTMLAnchorElement>('a.btn');
    expect(links[0].href).toContain('text=my+own+invitation');
    expect(links[1].href).toContain('text=my+own+invitation');
  });

  it('copies exactly what the card shows', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = setUp();
    const shown = boxes(fixture)[0].value;

    cards(fixture)[0].querySelector<HTMLButtonElement>('button.btn')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith(shown);
    expect(cards(fixture)[0].textContent).toContain('Invitation copied');
  });
});
