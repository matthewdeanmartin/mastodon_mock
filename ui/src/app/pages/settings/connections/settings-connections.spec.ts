import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueskySession, BskySession } from '../../../providers/bluesky/bluesky-session';
import { AnonymousCapabilities } from '../../../providers/anonymous/anonymous-capabilities';
import { DropboxSession } from '../../../providers/dropbox/dropbox-session';
import { GitHubSession } from '../../../providers/github/github-session';
import { CredentialLifetimeStore } from '../../../providers/credential-lifetime';
import { SettingsConnections } from './settings-connections';

describe('SettingsConnections (catalog)', () => {
  let bskySession: {
    session: WritableSignal<BskySession | null>;
    expiresAt: ReturnType<typeof vi.fn>;
    enforceLifetime: ReturnType<typeof vi.fn>;
  };
  let githubSession: {
    connected: WritableSignal<boolean>;
    expiresAt: ReturnType<typeof vi.fn>;
    enforceLifetime: ReturnType<typeof vi.fn>;
  };
  let dropboxSession: { connected: WritableSignal<boolean>; configured: boolean };
  let capabilities: { canUseBluesky: boolean };

  beforeEach(() => {
    localStorage.clear();
    bskySession = {
      session: signal<BskySession | null>(null),
      expiresAt: vi.fn(() => null),
      enforceLifetime: vi.fn(),
    };
    // The page governs this session under the credential-retention policy, so
    // the stub has to answer both halves of that contract.
    githubSession = {
      connected: signal(false),
      expiresAt: vi.fn(() => null),
      enforceLifetime: vi.fn(),
    };
    dropboxSession = { connected: signal(false), configured: true };
    capabilities = { canUseBluesky: true };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: BlueskySession, useValue: bskySession },
        { provide: GitHubSession, useValue: githubSession },
        { provide: DropboxSession, useValue: dropboxSession },
        { provide: AnonymousCapabilities, useValue: capabilities },
      ],
    });
  });

  function setUp(): ComponentFixture<SettingsConnections> {
    const fixture = TestBed.createComponent(SettingsConnections);
    fixture.detectChanges();
    return fixture;
  }

  function cards(fixture: ComponentFixture<SettingsConnections>): HTMLAnchorElement[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
        'a.catalog-card',
      ),
    ];
  }

  function cardFor(
    fixture: ComponentFixture<SettingsConnections>,
    label: string,
  ): HTMLAnchorElement {
    return cards(fixture).find((card) => card.textContent?.includes(label))!;
  }

  it('lists every connector with its pitch and what it enables', () => {
    const fixture = setUp();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(cards(fixture)).toHaveLength(4);
    for (const label of ['Bluesky', 'Raindrop.io', 'GitHub', 'Dropbox']) {
      expect(text).toContain(label);
    }
    // The catalog's whole job is saying what you get, not how to set it up.
    expect(text).toContain('Bluesky posts merged into your home timeline');
    expect(text).toContain('Read your unread notifications');
    expect(text).not.toContain('app password');
  });

  it('each card links to that connector’s own page', () => {
    const fixture = setUp();
    expect(cardFor(fixture, 'GitHub').getAttribute('href')).toBe('/settings/connections/github');
    expect(cardFor(fixture, 'Bluesky').getAttribute('href')).toBe('/settings/connections/bluesky');
  });

  it('shows connected state per connector, live', () => {
    const fixture = setUp();
    expect(cardFor(fixture, 'GitHub').textContent).toContain('Not connected');

    githubSession.connected.set(true);
    fixture.detectChanges();
    expect(cardFor(fixture, 'GitHub').textContent).toContain('Connected');
    // Unrelated connectors are unmoved.
    expect(cardFor(fixture, 'Dropbox').textContent).toContain('Not connected');
  });

  it('renders an unavailable connector greyed with the reason rather than hiding it', () => {
    dropboxSession.configured = false;
    capabilities.canUseBluesky = false;
    const fixture = setUp();

    const dropbox = cardFor(fixture, 'Dropbox');
    expect(dropbox.classList).toContain('unavailable');
    expect(dropbox.textContent).toContain('Unavailable');
    expect(dropbox.textContent).toContain('app key is missing');

    const bluesky = cardFor(fixture, 'Bluesky');
    expect(bluesky.classList).toContain('unavailable');
    expect(bluesky.textContent).toContain('Anonymous account');

    // Still four cards: unavailable is a state, not a removal.
    expect(cards(fixture)).toHaveLength(4);
  });

  it('governs every credential-bearing session and enforces on init', () => {
    const enforceAll = vi.spyOn(TestBed.inject(CredentialLifetimeStore), 'enforceAll');
    const govern = vi.spyOn(TestBed.inject(CredentialLifetimeStore), 'govern');
    setUp();

    expect(govern).toHaveBeenCalledOnce();
    expect(govern.mock.calls[0][0]).toHaveLength(3);
    expect(enforceAll).toHaveBeenCalled();
  });

  it('writes the retention policy through the store', () => {
    const fixture = setUp();
    const lifetimes = TestBed.inject(CredentialLifetimeStore);
    const el = fixture.nativeElement as HTMLElement;

    const thirtyDays = [...el.querySelectorAll<HTMLInputElement>('.lifetime-option input')].find(
      (input) => input.value === '30d',
    )!;
    thirtyDays.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(lifetimes.lifetime()).toBe('30d');
    // Shortening the window must re-check what is already stored, not wait for a reload.
    expect(bskySession.enforceLifetime).toHaveBeenCalled();
  });
});
