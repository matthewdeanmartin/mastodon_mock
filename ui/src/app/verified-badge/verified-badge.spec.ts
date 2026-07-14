import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../auth';
import { Account } from '../models';
import { VerifiedBadge } from './verified-badge';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: '1',
    username: 'alice',
    acct: 'alice',
    display_name: 'Alice',
    followers_count: 10,
    following_count: 5,
    statuses_count: 3,
    note: '',
    avatar: '',
    header: '',
    locked: false,
    bot: false,
    created_at: '2020-01-01T00:00:00Z',
    ...overrides,
  } as Account;
}

describe('VerifiedBadge', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function render(account: Account, viewer: Account | null = null): HTMLElement {
    const auth = TestBed.inject(Auth);
    auth.account.set(viewer);
    const fixture = TestBed.createComponent(VerifiedBadge);
    fixture.componentRef.setInput('account', account);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a public check at 50,000 followers or more', () => {
    const el = render(makeAccount({ followers_count: 50_000 }));
    const badge = el.querySelector('svg.badge');
    expect(badge).not.toBeNull();
    expect(badge!.classList.contains('self')).toBe(false);
  });

  it('shows no check below 50,000 followers for other accounts', () => {
    const el = render(makeAccount({ followers_count: 49_999 }));
    expect(el.querySelector('svg.badge')).toBeNull();
  });

  it("shows the self-only check on the viewer's own account regardless of followers", () => {
    const viewer = makeAccount({ id: '42', followers_count: 2 });
    const el = render(viewer, viewer);
    const badge = el.querySelector('svg.badge');
    expect(badge).not.toBeNull();
    expect(badge!.classList.contains('self')).toBe(true);
    expect(badge!.querySelector('title')?.textContent).toContain('only you');
  });

  it('prefers the public check when the viewer is also over the threshold', () => {
    const viewer = makeAccount({ id: '42', followers_count: 80_000 });
    const el = render(viewer, viewer);
    const badge = el.querySelector('svg.badge');
    expect(badge).not.toBeNull();
    expect(badge!.classList.contains('self')).toBe(false);
  });

  it('shows nothing to logged-out viewers for small accounts', () => {
    const el = render(makeAccount({ followers_count: 100 }), null);
    expect(el.querySelector('svg.badge')).toBeNull();
  });
});
