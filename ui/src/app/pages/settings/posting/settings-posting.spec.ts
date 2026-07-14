import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPosting } from './settings-posting';

/** Exposes SettingsPosting's protected signals for white-box testing. */
interface SettingsPostingInternals {
  privacy: WritableSignal<string>;
  sensitive: WritableSignal<boolean>;
  language: WritableSignal<string>;
  saved: WritableSignal<boolean>;
  save(): void;
}

function internals(fixture: ComponentFixture<SettingsPosting>): SettingsPostingInternals {
  return fixture.componentInstance as unknown as SettingsPostingInternals;
}

describe('SettingsPosting', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(): ComponentFixture<SettingsPosting> {
    const fixture = TestBed.createComponent(SettingsPosting);
    fixture.detectChanges();
    return fixture;
  }

  it('loads defaults from the account source', () => {
    const fixture = setUp();
    httpMock.expectOne('/api/v1/accounts/verify_credentials').flush({
      source: { privacy: 'unlisted', sensitive: true, language: 'de', note: '', fields: [] },
    });

    expect(internals(fixture).privacy()).toBe('unlisted');
    expect(internals(fixture).sensitive()).toBe(true);
    expect(internals(fixture).language()).toBe('de');
  });

  it('save() PATCHes update_credentials with source[...] form keys', () => {
    const fixture = setUp();
    httpMock.expectOne('/api/v1/accounts/verify_credentials').flush({
      source: { privacy: 'public', sensitive: false, language: null, note: '', fields: [] },
    });

    internals(fixture).privacy.set('private');
    internals(fixture).sensitive.set(true);
    internals(fixture).language.set('fr');
    internals(fixture).save();

    const req = httpMock.expectOne('/api/v1/accounts/update_credentials');
    expect(req.request.method).toBe('PATCH');
    const body = req.request.body as FormData;
    expect(body.get('source[privacy]')).toBe('private');
    expect(body.get('source[sensitive]')).toBe('true');
    expect(body.get('source[language]')).toBe('fr');
    req.flush({});

    expect(internals(fixture).saved()).toBe(true);
  });
});
