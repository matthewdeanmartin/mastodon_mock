import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server } from './server';
import { serverInterceptor } from './server.interceptor';

describe('serverInterceptor', () => {
  let httpMock: HttpTestingController;
  let server: Server;
  let httpClient: HttpClient;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        Server,
        provideHttpClient(withInterceptors([serverInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    server = TestBed.inject(Server);
    httpClient = TestBed.inject(HttpClient);
  });

  afterEach(() => httpMock.verify());

  it('prefixes relative URLs with the baseUrl when one is set', () => {
    server.setBaseUrl('https://mastodon.social');

    httpClient.get('/api/v1/timelines/home').subscribe();

    httpMock.expectOne('https://mastodon.social/api/v1/timelines/home').flush([]);
  });

  it('passes relative URLs through unchanged when baseUrl is empty (mock mode)', () => {
    // localStorage cleared; Server defaults to '' (mock mode)
    expect(server.baseUrl()).toBe('');

    httpClient.get('/api/v1/timelines/home').subscribe();

    httpMock.expectOne('/api/v1/timelines/home').flush([]);
  });

  it('does not modify already-absolute URLs regardless of baseUrl', () => {
    server.setBaseUrl('https://mastodon.social');

    httpClient.get('https://other.instance/api/v1/timelines/home').subscribe();

    // URL must pass through without modification since it doesn't start with '/'
    httpMock.expectOne('https://other.instance/api/v1/timelines/home').flush([]);
  });
});
