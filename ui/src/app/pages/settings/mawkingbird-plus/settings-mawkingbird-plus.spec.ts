import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsMawkingbirdPlus } from './settings-mawkingbird-plus';
import { PlusSession } from '../../../providers/account/plus-session';
import { MawkingbirdSession } from '../../../providers/account/mawkingbird-session';

/**
 * A stand-in for the real session, so these specs exercise the page's rendering
 * rather than the network.
 *
 * Note what the user object does NOT carry: no name, no email address. The
 * token deliberately holds no personal information — it travels in a header to
 * services that log less than they could — so the page has none to render and
 * these specs must not pretend otherwise.
 */
class FakeMawkingbirdSession {
  user = signal<{ auth: 'anon' | 'email' | 'idp'; tier: 'free' | 'plus' | 'business' } | null>(
    null,
  );
  ready = signal(false);
  error = signal<string | null>(null);
  sendingLink = signal(false);
  ensureReady = vi.fn().mockResolvedValue(undefined);
  requestSignInLink = vi.fn().mockResolvedValue(true);
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
  let session: FakeMawkingbirdSession;
  let plus: FakePlusSession;

  beforeEach(() => {
    session = new FakeMawkingbirdSession();
    plus = new FakePlusSession();
    TestBed.configureTestingModule({
      imports: [SettingsMawkingbirdPlus],
      providers: [
        { provide: MawkingbirdSession, useValue: session },
        { provide: PlusSession, useValue: plus },
      ],
    });
    fixture = TestBed.createComponent(SettingsMawkingbirdPlus);
  });

  const render = () => {
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  };

  const signedIn = (auth: 'email' | 'idp' = 'email') => session.user.set({ auth, tier: 'free' });

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

  it('shows how a signed-in user proved who they are', () => {
    session.ready.set(true);
    signedIn();
    const text = render();

    // "Your account" since sign-in and plan were merged into one block: they
    // were two sections answering overlapping halves of the same question.
    expect(text).toContain('Your account');
    expect(text).toContain('Confirmed email address');
  });

  it('renders no personal information, because the token carries none', () => {
    // The page cannot show a name or an address even if it wanted to: the token
    // holds neither. Asserted so that re-adding either has to be a deliberate
    // change to the claim set rather than a quiet template edit.
    session.ready.set(true);
    signedIn();
    const text = render();

    expect(text).not.toContain('@');
    expect(text).not.toContain('Name');
  });

  it('warns that existing tokens outlive sign-out', () => {
    // Revocation stops new tokens; it cannot recall one already issued. Saying
    // so is the honest alternative to implying an instant global sign-out.
    session.ready.set(true);
    signedIn();

    expect(render()).toContain('stays valid until it expires');
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

    // The renewal date now sits next to the plan rather than in its own
    // section. The claim is unchanged: a supporter is told when it renews.
    expect(text).toContain('renews');
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
    expect(text).toContain('cancelled');
    // "yours until" rather than "runs until" — same promise, said next to the
    // plan it qualifies.
    expect(text).toContain('yours until');
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

  it('requests a sign-in link for the typed address', async () => {
    session.ready.set(true);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#plus-email') as HTMLInputElement;
    input.value = 'person@example.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(session.requestSignInLink).toHaveBeenCalledWith('person@example.com');
    expect(fixture.nativeElement.textContent).toContain('a sign-in link is on its way');
  });

  it('never implies the address was recognised', async () => {
    // The service answers identically for a known and an unknown address, and
    // the UI must not hand back the answer the endpoint refuses to give. A
    // message like "welcome back" here would be an enumeration oracle wearing a
    // friendly greeting.
    session.ready.set(true);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#plus-email') as HTMLInputElement;
    input.value = 'stranger@example.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('If that address can receive mail');
    expect(text).not.toContain('Welcome back');
    expect(text).not.toContain('No account');
  });

  it('does not claim a link was sent when the request failed', async () => {
    // A rate limit or a network failure must show the error, not "check your
    // inbox" for mail that was never sent.
    session.requestSignInLink.mockResolvedValue(false);
    session.ready.set(true);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#plus-email') as HTMLInputElement;
    input.value = 'person@example.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('on its way');
  });

  it('shows a service error next to the sign-in form', async () => {
    // The failure mode this exists for: the page said only "Not signed in"
    // while the real cause — an unreachable service, a rate limit, a
    // misconfigured deployment — was visible nowhere but the browser console.
    session.ready.set(true);
    session.error.set('Could not reach the Mawkingbird account service.');
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Could not reach');
  });

  it('shows a service error only once', async () => {
    session.ready.set(true);
    session.error.set('Something went wrong.');
    fixture.detectChanges();

    // Two copies of the same alert is how a page teaches people to ignore them.
    const alerts = fixture.nativeElement.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(1);
  });

  it('signs out through the session', () => {
    session.ready.set(true);
    signedIn();
    fixture.detectChanges();

    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (element) => (element as HTMLButtonElement).textContent?.trim() === 'Sign out',
    );
    (button as HTMLButtonElement).click();

    expect(session.signOut).toHaveBeenCalled();
  });
});
