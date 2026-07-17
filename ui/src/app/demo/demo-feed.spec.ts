import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Status } from '../models';
import { EXTERNAL_FETCH } from '../providers/external-fetch';
import { DEMO_SERVER, DemoFeed } from './demo-feed';

/**
 * The demo feed must stay segregated from the real API plumbing: pinned to the
 * demo instance with absolute URLs, and flagged external so the auth
 * interceptor never attaches a token and the health interceptor never
 * fail-whales on it. These tests assert exactly that contract.
 */
describe('DemoFeed (HTTP isolated)', () => {
  let feed: DemoFeed;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    feed = TestBed.inject(DemoFeed);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function statusStub(id: string): Status {
    return { id, content: '<p>hi</p>' } as Status;
  }

  it('trendingStatuses: GETs the demo server trends, marked external', () => {
    let result: Status[] | undefined;
    feed.trendingStatuses().subscribe((s) => (result = s));

    const req = httpMock.expectOne(`${DEMO_SERVER}/api/v1/trends/statuses?limit=20`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(EXTERNAL_FETCH)).toBe(true);

    req.flush([statusStub('1')]);
    expect(result!.length).toBe(1);
  });

  it('trendingStatuses: pages with offset', () => {
    feed.trendingStatuses(40).subscribe();
    const req = httpMock.expectOne(`${DEMO_SERVER}/api/v1/trends/statuses?limit=20&offset=40`);
    req.flush([]);
  });

  it('trendingTags: GETs the demo server trending tags, marked external', () => {
    feed.trendingTags().subscribe();
    const req = httpMock.expectOne(`${DEMO_SERVER}/api/v1/trends/tags?limit=10`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(EXTERNAL_FETCH)).toBe(true);
    req.flush([]);
  });

  it('tagTimeline: GETs the demo server tag timeline, marked external', () => {
    let result: Status[] | undefined;
    feed.tagTimeline('cats').subscribe((s) => (result = s));

    const req = httpMock.expectOne(`${DEMO_SERVER}/api/v1/timelines/tag/cats?limit=20`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(EXTERNAL_FETCH)).toBe(true);

    req.flush([statusStub('9')]);
    expect(result![0].id).toBe('9');
  });

  it('tagTimeline: pages older with max_id and URL-encodes the tag', () => {
    feed.tagTimeline('c++', '123').subscribe();
    const req = httpMock.expectOne(
      `${DEMO_SERVER}/api/v1/timelines/tag/c%2B%2B?limit=20&max_id=123`,
    );
    req.flush([]);
  });
});
