import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PasteHistory } from './paste-history';

describe('PasteHistory', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('persists links and edit keys for the browser', () => {
    const history = TestBed.inject(PasteHistory);
    history.add(
      'pastepile',
      'Pastepile',
      {
        title: 'Test',
        content: 'hello',
        language: 'plaintext',
        expiry: '1w',
        visibility: 'unlisted',
      },
      {
        slug: 'abc',
        url: 'https://pastepile.com/p/abc',
        rawUrl: 'https://pastepile.com/raw/abc',
        editKey: 'secret',
      },
    );

    const stored = JSON.parse(localStorage.getItem('mockingbird_pastes') ?? '[]');
    expect(stored[0].providerId).toBe('pastepile');
    expect(stored[0].editKey).toBe('secret');
  });

  it('updates and forgets a record', () => {
    const history = TestBed.inject(PasteHistory);
    history.add(
      'pastepile',
      'Pastepile',
      {
        title: '',
        content: 'old',
        language: 'plaintext',
        expiry: '1d',
        visibility: 'public',
      },
      {
        slug: 'abc',
        url: 'https://pastepile.com/p/abc',
        rawUrl: 'https://pastepile.com/raw/abc',
        editKey: 'secret',
      },
    );

    history.update('abc', { content: 'new' });
    expect(history.records()[0].content).toBe('new');
    history.remove('abc');
    expect(history.records()).toEqual([]);
  });
});
