import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from './auth';
import { authInterceptor } from './auth.interceptor';
import { externalFetch } from './providers/external-fetch';
import { Server } from './server';

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;
  let auth: Auth;
  let httpClient: HttpClient;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        Auth,
        Server,
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
    httpClient = TestBed.inject(HttpClient);
  });

  afterEach(() => httpMock.verify());

  it('attaches a Bearer token when a token is set', () => {
    auth.setToken('my-access-token');

    httpClient.get('/api/v1/timelines/home').subscribe();

    const req = httpMock.expectOne('/api/v1/timelines/home');
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-access-token');
    req.flush([]);
  });

  it('does not add an Authorization header when there is no token', () => {
    // localStorage cleared in beforeEach; no token set
    httpClient.get('/api/v1/timelines/home').subscribe();

    const req = httpMock.expectOne('/api/v1/timelines/home');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('never sends the token to external hosts (RSS feeds etc.)', () => {
    auth.setToken('my-access-token');

    httpClient
      .get('https://example.com/feed.xml', { responseType: 'text', context: externalFetch() })
      .subscribe();

    const req = httpMock.expectOne('https://example.com/feed.xml');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush('<rss/>');
  });

  it('does not overwrite a caller-supplied Authorization header', () => {
    auth.setToken('my-access-token');

    httpClient
      .get('/api/v1/timelines/home', {
        headers: { Authorization: 'Bearer caller-supplied-token' },
      })
      .subscribe();

    const req = httpMock.expectOne('/api/v1/timelines/home');
    expect(req.request.headers.get('Authorization')).toBe('Bearer caller-supplied-token');
    req.flush([]);
  });
});
