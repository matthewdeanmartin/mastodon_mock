import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsMawkingbirdPlus } from './settings-mawkingbird-plus';
import { PlusSession } from '../../../providers/workos/plus-session';
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

/** A stand-in for the billing half, so these specs stay about rendering. */
class FakePlusSession {
  tier = signal<'free' | 'plus'>('free');
  subscription = signal<{ renewsAt: number; cancelAtPeriodEnd: boolean } | null>(null);
  error = signal<string | null>(null);
  startingCheckout = signal(false);
  isSupporter = () => this.tier() === 'plus';
  refresh = vi.fn().mockResolvedValue(undefined);
  clear = vi.fn();
  startCheckout = vi.fn().mockResolvedValue(undefined);
}

describe('SettingsMawkingbirdPlus', () => {
  let fixture: ComponentFixture<SettingsMawkingbirdPlus>;
  let session: FakeWorkosSession;
  let plus: FakePlusSession;

  beforeEach(() => {
    session = new FakeWorkosSession();
    plus = new FakePlusSession();
    TestBed.configureTestingModule({
      imports: [SettingsMawkingbirdPlus],
      providers: [
        { provide: WorkosSession, useValue: session },
        { provide: PlusSession, useValue: plus },
      ],
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

  it('offers the subscription to a signed-in non-supporter', () => {
    session.ready.set(true);
    signedIn();
    const text = render();

    expect(text).toContain('Support Mawkingbird');
    expect(text).toContain('$30');
    // Honest framing: the free tier is unaffected either way.
    expect(text).toContain('free and stays free');
  });

  it('starts checkout when the button is pressed', () => {
    session.ready.set(true);
    signedIn();
    render();

    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((element) =>
      (element as HTMLButtonElement).textContent?.includes('$30/year'),
    ) as HTMLButtonElement | undefined;
    button?.click();

    expect(plus.startCheckout).toHaveBeenCalled();
  });

  it('shows the renewal date for a supporter', () => {
    session.ready.set(true);
    signedIn();
    plus.tier.set('plus');
    plus.subscription.set({ renewsAt: Date.UTC(2027, 7, 12), cancelAtPeriodEnd: false });
    const text = render();

    expect(text).toContain('Renews annually');
    expect(text).toContain('2027');
    expect(text).not.toContain('Support Mawkingbird —');
  });

  it('tells a cancelled supporter when their support ends', () => {
    session.ready.set(true);
    signedIn();
    plus.tier.set('plus');
    plus.subscription.set({ renewsAt: Date.UTC(2027, 7, 12), cancelAtPeriodEnd: true });
    const text = render();

    // The distinction the whole `cancelAtPeriodEnd` field exists for: someone
    // who just cancelled needs to see that it worked *and* that they keep the
    // year they paid for.
    expect(text).toContain('Cancelled');
    expect(text).toContain('runs until');
    expect(text).toContain('2027');
  });

  it('thanks a supporter returning from a successful checkout', async () => {
    vi.stubGlobal('location', { ...location, search: '?checkout=success' });
    session.ready.set(true);
    signedIn();

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Thank you');
    // Re-minted immediately, so the tier updates now rather than in fifteen
    // minutes.
    expect(plus.refresh).toHaveBeenCalled();
  });

  it('says nothing was charged when checkout was cancelled', async () => {
    vi.stubGlobal('location', { ...location, search: '?checkout=cancel' });
    session.ready.set(true);
    signedIn();

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Nothing was charged');
  });

  it('clears the billing session on sign out', async () => {
    session.ready.set(true);
    signedIn();
    render();

    await fixture.componentInstance['signOut']();

    // Otherwise the next person to sign in on this browser would briefly see
    // the previous account's tier.
    expect(plus.clear).toHaveBeenCalled();
    expect(session.signOut).toHaveBeenCalled();
  });

  it('shows a checkout failure beside the button that caused it', () => {
    session.ready.set(true);
    signedIn();
    plus.error.set('Subscriptions are not configured on this deployment.');
    fixture.detectChanges();

    const offer = fixture.nativeElement.querySelector('.plus-offer') as HTMLElement | null;
    // Inside the offer section, not stranded at the foot of the page below the
    // fine print — the whole point is that nobody should have to go looking.
    expect(offer?.querySelector('[role="alert"]')?.textContent).toContain('not configured');
  });

  it('shows a billing error to a supporter, who has no subscribe button', () => {
    session.ready.set(true);
    signedIn();
    plus.tier.set('plus');
    plus.error.set('Could not reach the subscription service.');
    fixture.detectChanges();

    const alerts = Array.from(
      fixture.nativeElement.querySelectorAll('[role="alert"]'),
    ) as HTMLElement[];
    const matching = alerts.filter((element) => element.textContent?.includes('Could not reach'));
    // Exactly one: the two render sites are mutually exclusive by design.
    expect(matching).toHaveLength(1);
  });

  it('surfaces a billing error', () => {
    session.ready.set(true);
    signedIn();
    plus.error.set('Could not start checkout. Please try again.');
    fixture.detectChanges();

    const alerts = Array.from(
      fixture.nativeElement.querySelectorAll('[role="alert"]'),
    ) as HTMLElement[];
    expect(
      alerts.some((element) => element.textContent?.includes('Could not start checkout')),
    ).toBe(true);
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
