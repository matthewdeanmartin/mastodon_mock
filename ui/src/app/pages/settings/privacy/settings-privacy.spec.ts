import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPrivacy } from './settings-privacy';

/** Exposes SettingsPrivacy's protected signals for white-box testing. */
interface SettingsPrivacyInternals {
  locked: WritableSignal<boolean>;
  discoverable: WritableSignal<boolean>;
  bot: WritableSignal<boolean>;
  saved: WritableSignal<boolean>;
  save(): void;
}

function internals(fixture: ComponentFixture<SettingsPrivacy>): SettingsPrivacyInternals {
  return fixture.componentInstance as unknown as SettingsPrivacyInternals;
}

describe('SettingsPrivacy', () => {
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

  function setUp(): ComponentFixture<SettingsPrivacy> {
    const fixture = TestBed.createComponent(SettingsPrivacy);
    fixture.detectChanges();
    return fixture;
  }

  it('loads flags from verify_credentials', () => {
    const fixture = setUp();
    httpMock
      .expectOne('/api/v1/accounts/verify_credentials')
      .flush({ locked: true, discoverable: false, bot: true });

    expect(internals(fixture).locked()).toBe(true);
    expect(internals(fixture).discoverable()).toBe(false);
    expect(internals(fixture).bot()).toBe(true);
  });

  it('save() PATCHes update_credentials with string booleans', () => {
    const fixture = setUp();
    httpMock
      .expectOne('/api/v1/accounts/verify_credentials')
      .flush({ locked: false, discoverable: true, bot: false });

    internals(fixture).locked.set(true);
    internals(fixture).save();

    const req = httpMock.expectOne('/api/v1/accounts/update_credentials');
    expect(req.request.method).toBe('PATCH');
    const body = req.request.body as FormData;
    expect(body.get('locked')).toBe('true');
    expect(body.get('discoverable')).toBe('true');
    expect(body.get('bot')).toBe('false');
    req.flush({ locked: true, discoverable: true, bot: false });

    expect(internals(fixture).saved()).toBe(true);
  });
});
