import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../models';
import { AccountHoverCard } from './account-hover-card';

const ACCOUNT = {
  id: '42',
  username: 'kay',
  acct: 'kay@example.social',
  display_name: 'Kay',
  note: '<p>I take photographs of bridges.</p>',
  avatar: 'https://example.social/a.png',
  followers_count: 321,
  following_count: 45,
  statuses_count: 6789,
} as Account;

describe('AccountHoverCard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function render(account: Account): HTMLElement {
    const fixture = TestBed.createComponent(AccountHoverCard);
    fixture.componentRef.setInput('account', account);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows name, handle, bio and the three stats', () => {
    const el = render(ACCOUNT);
    expect(el.querySelector('.hc-name')?.textContent).toContain('Kay');
    expect(el.querySelector('.hc-acct')?.textContent).toContain('@kay@example.social');
    expect(el.querySelector('.hc-note')?.textContent).toContain('photographs of bridges');
    const stats = el.querySelector('.hc-stats')?.textContent ?? '';
    expect(stats).toContain('6,789');
    expect(stats).toContain('45');
    expect(stats).toContain('321');
  });

  it('is info-only: renders no buttons or links', () => {
    const el = render(ACCOUNT);
    expect(el.querySelectorAll('button, a')).toHaveLength(0);
  });

  it('omits the bio block when the account has no note', () => {
    const el = render({ ...ACCOUNT, note: '' });
    expect(el.querySelector('.hc-note')).toBeNull();
  });
});
