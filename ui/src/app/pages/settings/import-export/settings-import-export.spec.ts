import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportReport } from '../../../models';
import { SettingsImportExport } from './settings-import-export';

/** Exposes SettingsImportExport's protected signals for white-box testing. */
interface SettingsImportExportInternals {
  importKind: WritableSignal<'following' | 'mutes' | 'blocks'>;
  csvText: WritableSignal<string>;
  report: WritableSignal<ImportReport | null>;
  download(kind: 'following' | 'mutes' | 'blocks'): void;
  upload(): void;
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
});
