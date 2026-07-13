import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServerHealth } from './server-health';

describe('ServerHealth', () => {
  let httpMock: HttpTestingController;
  let health: ServerHealth;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ServerHealth, provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    health = TestBed.inject(ServerHealth);
  });

  afterEach(() => httpMock.verify());

  it('starts up (not down)', () => {
    expect(health.down()).toBe(false);
    expect(health.checking()).toBe(false);
  });

  it('markDown/markUp toggle the down signal', () => {
    health.markDown();
    expect(health.down()).toBe(true);
    health.markUp();
    expect(health.down()).toBe(false);
  });

  it('recheck() pings /api/v2/instance and clears down on success', () => {
    health.markDown();

    health.recheck();
    expect(health.checking()).toBe(true);

    httpMock.expectOne('/api/v2/instance').flush({ domain: 'x' });

    expect(health.down()).toBe(false);
    expect(health.checking()).toBe(false);
  });

  it('recheck() leaves the server down when the ping fails', () => {
    health.markDown();

    health.recheck();
    httpMock.expectOne('/api/v2/instance').error(new ProgressEvent('error'), { status: 0 });

    expect(health.down()).toBe(true);
    expect(health.checking()).toBe(false);
  });

  it('recheck() ignores a second call while one is in flight', () => {
    health.markDown();
    health.recheck();
    health.recheck(); // should be a no-op; only one request outstanding

    const req = httpMock.expectOne('/api/v2/instance');
    req.flush({ domain: 'x' });
    expect(health.down()).toBe(false);
  });
});
