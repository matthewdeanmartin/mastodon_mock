import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { externalFetch } from '../providers/external-fetch';
import { Server } from '../server';
import { ApiMetrics } from './api-metrics';
import { metricsInterceptor } from './metrics.interceptor';

describe('metricsInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let metrics: ApiMetrics;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([metricsInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    TestBed.inject(Server).setBaseUrl('https://mastodon.social');
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    metrics = TestBed.inject(ApiMetrics);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('counts Anonymous public requests to the selected server', () => {
    http
      .get('https://mastodon.social/api/v1/timelines/public', { context: externalFetch() })
      .subscribe();
    httpMock.expectOne('https://mastodon.social/api/v1/timelines/public').flush([]);

    expect(metrics.totals().count).toBe(1);
  });

  it('still excludes external providers and feeds', () => {
    http.get('https://feeds.example/news.rss', { context: externalFetch() }).subscribe();
    httpMock.expectOne('https://feeds.example/news.rss').flush('ok');

    expect(metrics.totals().count).toBe(0);
  });
});
