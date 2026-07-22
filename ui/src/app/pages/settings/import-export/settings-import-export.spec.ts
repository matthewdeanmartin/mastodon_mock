import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, ImportReport } from '../../../models';
import { Auth } from '../../../auth';
import { parseHandles } from '../../../import-follows';
import { followingAccountsCsv, SettingsImportExport } from './settings-import-export';

/** Exposes SettingsImportExport's protected signals for white-box testing. */
interface SettingsImportExportInternals {
  importKind: WritableSignal<'following' | 'mutes' | 'blocks'>;
  csvText: WritableSignal<string>;
  report: WritableSignal<ImportReport | null>;
  exportCount: WritableSignal<number>;
  download(kind: 'following' | 'mutes' | 'blocks'): void;
  upload(): void;
  exportFriends(): Promise<void>;
}

function internals(fixture: ComponentFixture<SettingsImportExport>): SettingsImportExportInternals {
  return fixture.componentInstance as unknown as SettingsImportExportInternals;
}

describe('SettingsImportExport', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    // jsdom does not implement object URLs; stub them for download().
    URL.createObjectURL = () => 'blob:mock';
    URL.revokeObjectURL = () => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.mocked(HTMLAnchorElement.prototype.click).mockClear();
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(): ComponentFixture<SettingsImportExport> {
    const fixture = TestBed.createComponent(SettingsImportExport);
    fixture.detectChanges();
    return fixture;
  }

  it('download() GETs the export endpoint for the requested kind', () => {
    const fixture = setUp();
    internals(fixture).download('mutes');

    const req = httpMock.expectOne('/api/v1/_mock/export/mutes');
    expect(req.request.method).toBe('GET');
    req.flush('Account address\nbob@example.com\n');
  });

  it('upload() POSTs the CSV with the selected type and stores the report', () => {
    const fixture = setUp();
    internals(fixture).importKind.set('blocks');
    internals(fixture).csvText.set('spammer@example.com\n');

    internals(fixture).upload();

    const req = httpMock.expectOne('/api/v1/_mock/import');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ type: 'blocks', csv: 'spammer@example.com\n' });
    req.flush({ type: 'blocks', imported: 1, skipped: ['nobody@example.com'] });

    expect(internals(fixture).report()).toEqual({
      type: 'blocks',
      imported: 1,
      skipped: ['nobody@example.com'],
    });
  });

  it('upload() with empty CSV issues no request', () => {
    const fixture = setUp();
    internals(fixture).csvText.set('   ');

    internals(fixture).upload();

    httpMock.expectNone('/api/v1/_mock/import');
  });

  it('writes the same following_accounts.csv shape accepted by the importer', () => {
    const csv = followingAccountsCsv([
      { id: '1', acct: 'alice@remote.social', username: 'alice', url: '' } as Account,
      {
        id: '2',
        acct: 'bob',
        username: 'bob',
        url: 'https://home.social/@bob',
      } as Account,
    ]);

    expect(csv).toContain('Account address,Show boosts,Notify on new posts,Languages');
    expect(csv).toContain('alice@remote.social,true,false,');
    expect(csv).toContain('bob@home.social,true,false,');
    expect(parseHandles(csv)).toEqual(['alice@remote.social', 'bob@home.social']);
  });

  it('pages through every friend before downloading the export', async () => {
    const auth = TestBed.inject(Auth);
    auth.setToken('token');
    auth.setAccount({ id: 'me', acct: 'me@home.social' } as Account);
    const fixture = setUp();
    const firstPage = Array.from(
      { length: 80 },
      (_, index) =>
        ({
          id: String(index + 1),
          acct: `friend${index + 1}@remote.social`,
          username: `friend${index + 1}`,
          url: '',
        }) as Account,
    );

    const exported = internals(fixture).exportFriends();
    httpMock.expectOne('/api/v1/accounts/me/following?limit=80').flush(firstPage);
    await Promise.resolve();
    httpMock
      .expectOne('/api/v1/accounts/me/following?limit=80&max_id=80')
      .flush([{ id: '81', acct: 'last@remote.social', username: 'last', url: '' } as Account]);
    await exported;

    expect(internals(fixture).exportCount()).toBe(81);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
});
