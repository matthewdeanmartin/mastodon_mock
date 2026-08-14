import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsMawkingbirdPlus } from './settings-mawkingbird-plus';
import { WorkosSession } from '../../../providers/workos/workos-session';

/**
 * A stand-in for the real session, so these specs exercise the page's rendering
 * rather than the SDK. `WorkosSession` has its own spec for the flow itself.
 */
class FakeWorkosSession {
  configured = true;
  user = signal<{ email: string; firstName: string | null; lastName: string | null } | null>(null);
  ready = signal(false);
  error = signal<string | null>(null);
  ensureReady = vi.fn().mockResolvedValue(undefined);
  signIn = vi.fn().mockResolvedValue(undefined);
  signUp = vi.fn().mockResolvedValue(undefined);
  signOut = vi.fn().mockResolvedValue(undefined);
}

describe('SettingsMawkingbirdPlus', () => {
  let fixture: ComponentFixture<SettingsMawkingbirdPlus>;
  let session: FakeWorkosSession;

  beforeEach(() => {
    session = new FakeWorkosSession();
    TestBed.configureTestingModule({
      imports: [SettingsMawkingbirdPlus],
      providers: [{ provide: WorkosSession, useValue: session }],
    });
    fixture = TestBed.createComponent(SettingsMawkingbirdPlus);
  });

  const render = () => {
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  };

  const signedIn = (
    overrides: Partial<{ firstName: string | null; lastName: string | null }> = {},
  ) =>
    session.user.set({
      email: 'reader@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      ...overrides,
    });

  it('completes a pending sign-in redirect when the page loads', () => {
    // This page is the OAuth redirect target, so initialising is what finishes
    // a sign-in — there is no separate callback route to do it.
    render();
    expect(session.ensureReady).toHaveBeenCalled();
  });

  it('shows a loading state until initialisation settles', () => {
    expect(render()).toContain('Checking your account');
  });

  it('offers sign-in when nobody is signed in', () => {
    session.ready.set(true);
    const text = render();

    expect(text).toContain('Not signed in');
    expect(text).not.toContain('Sign out');
  });

  it('shows the name and email of a signed-in user', () => {
    session.ready.set(true);
    signedIn();
    const text = render();

    expect(text).toContain('Signed in');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('reader@example.com');
  });

  it('shows the email alone when the provider supplied no name', () => {
    session.ready.set(true);
    signedIn({ firstName: null, lastName: null });
    const text = render();

    // Email is the identifier, so it is the one field that always renders.
    expect(text).toContain('reader@example.com');
    expect(text).not.toContain('Name');
  });

  it('explains itself instead of offering an account when the build has no client id', () => {
    session.configured = false;
    session.ready.set(true);
    const text = render();

    expect(text).toContain('not configured for this build');
    expect(text).not.toContain('Sign in');
  });

  it('surfaces an error as an alert', () => {
    session.ready.set(true);
    session.error.set('origin not allowed');
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement | null;
    expect(alert?.textContent).toContain('origin not allowed');
  });

  it('signs in, signs up and signs out through the session', () => {
    session.ready.set(true);
    fixture.detectChanges();

    const buttons = () =>
      Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const click = (label: string) => {
      buttons()
        .find((button) => button.textContent?.trim() === label)
        ?.click();
      fixture.detectChanges();
    };

    click('Sign in');
    expect(session.signIn).toHaveBeenCalled();

    click('Create an account');
    expect(session.signUp).toHaveBeenCalled();

    signedIn();
    fixture.detectChanges();
    click('Sign out');
    expect(session.signOut).toHaveBeenCalled();
  });
});
