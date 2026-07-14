import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Status, Tag as TagEntity } from '../../models';
import { Tag } from './tag';

interface TagInternals {
  tag: WritableSignal<string>;
  tagInfo: WritableSignal<TagEntity | null>;
  statuses: WritableSignal<Status[]>;
  loading: WritableSignal<boolean>;
}

function internals(fixture: ComponentFixture<Tag>): TagInternals {
  return fixture.componentInstance as unknown as TagInternals;
}

function makeStatus(id: string): Status {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: '1', username: 'user', acct: 'user', display_name: 'User' } as never,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
  };
}

function makeTagEntity(name: string, overrides: Partial<TagEntity> = {}): TagEntity {
  return {
    id: name,
    name,
    url: `https://example.com/tags/${name}`,
    following: false,
    featuring: false,
    history: [],
    ...overrides,
  };
}

let httpMock: HttpTestingController;

function setUpWithTag(tagName: string): ComponentFixture<Tag> {
  TestBed.overrideProvider(ActivatedRoute, {
    useValue: { paramMap: of(convertToParamMap({ tag: tagName })) },
  });
  httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Tag);
  fixture.detectChanges();
  return fixture;
}

describe('Tag (timeline)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ---------------------------------------------------------------- initial load

  it('fetches tag info and timeline for the route param', () => {
    const fixture = setUpWithTag('cats');

    httpMock.expectOne('/api/v1/tags/cats').flush(makeTagEntity('cats'));
    httpMock
      .expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/cats'))
      .flush([makeStatus('1')]);

    expect(internals(fixture).tag()).toBe('cats');
    expect(internals(fixture).tagInfo()?.name).toBe('cats');
    expect(internals(fixture).statuses()).toHaveLength(1);
    expect(internals(fixture).loading()).toBe(false);
  });

  it('URL-encodes the tag name in requests', () => {
    setUpWithTag('C++ tips');

    httpMock.expectOne('/api/v1/tags/C%2B%2B%20tips').flush(makeTagEntity('C++ tips'));
    httpMock.expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/C%2B%2B%20tips')).flush([]);
  });

  it('clears loading on timeline HTTP error', () => {
    const fixture = setUpWithTag('rust');

    httpMock.expectOne('/api/v1/tags/rust').flush(makeTagEntity('rust'));
    httpMock
      .expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/rust'))
      .flush('', { status: 500, statusText: 'Error' });

    expect(internals(fixture).loading()).toBe(false);
  });

  // ---------------------------------------------------------------- toggleFollow

  it('toggleFollow: POSTs to /follow when not following', () => {
    const fixture = setUpWithTag('python');
    httpMock.expectOne('/api/v1/tags/python').flush(makeTagEntity('python', { following: false }));
    httpMock.expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/python')).flush([]);

    fixture.componentInstance.toggleFollow();

    const req = httpMock.expectOne('/api/v1/tags/python/follow');
    expect(req.request.method).toBe('POST');
    req.flush(makeTagEntity('python', { following: true }));

    expect(internals(fixture).tagInfo()?.following).toBe(true);
  });

  it('toggleFollow: POSTs to /unfollow when already following', () => {
    const fixture = setUpWithTag('python');
    httpMock.expectOne('/api/v1/tags/python').flush(makeTagEntity('python', { following: true }));
    httpMock.expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/python')).flush([]);

    fixture.componentInstance.toggleFollow();

    const req = httpMock.expectOne('/api/v1/tags/python/unfollow');
    expect(req.request.method).toBe('POST');
    req.flush(makeTagEntity('python', { following: false }));
  });

  it('toggleFollow: does nothing when tagInfo is null', () => {
    const fixture = setUpWithTag('unknowntag');
    httpMock.expectOne('/api/v1/tags/unknowntag').flush(makeTagEntity('unknowntag'));
    httpMock.expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/unknowntag')).flush([]);

    // Manually clear tagInfo to simulate null state.
    internals(fixture).tagInfo.set(null);
    fixture.componentInstance.toggleFollow();

    // No follow/unfollow request should be issued.
    httpMock.expectNone('/api/v1/tags/unknowntag/follow');
  });

  // ---------------------------------------------------------------- toggleFeature

  it('toggleFeature: POSTs to /feature when not featuring', () => {
    const fixture = setUpWithTag('art');
    httpMock.expectOne('/api/v1/tags/art').flush(makeTagEntity('art', { featuring: false }));
    httpMock.expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/art')).flush([]);

    fixture.componentInstance.toggleFeature();

    const req = httpMock.expectOne('/api/v1/tags/art/feature');
    expect(req.request.method).toBe('POST');
    req.flush(makeTagEntity('art', { featuring: true }));
    expect(internals(fixture).tagInfo()?.featuring).toBe(true);
  });

  it('toggleFeature: POSTs to /unfeature when already featuring', () => {
    const fixture = setUpWithTag('art');
    httpMock.expectOne('/api/v1/tags/art').flush(makeTagEntity('art', { featuring: true }));
    httpMock.expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/art')).flush([]);

    fixture.componentInstance.toggleFeature();

    const req = httpMock.expectOne('/api/v1/tags/art/unfeature');
    expect(req.request.method).toBe('POST');
    req.flush(makeTagEntity('art', { featuring: false }));
  });

  // ---------------------------------------------------------------- onChanged / onDeleted

  it('onChanged: updates the status at the given index', () => {
    const fixture = setUpWithTag('news');
    httpMock.expectOne('/api/v1/tags/news').flush(makeTagEntity('news'));
    httpMock
      .expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/news'))
      .flush([makeStatus('1'), makeStatus('2')]);

    const updated = { ...makeStatus('1'), favourited: true };
    fixture.componentInstance.onChanged(0, updated);

    expect(internals(fixture).statuses()[0].favourited).toBe(true);
    expect(internals(fixture).statuses()[1].id).toBe('2');
  });

  it('onDeleted: removes the status by id', () => {
    const fixture = setUpWithTag('tech');
    httpMock.expectOne('/api/v1/tags/tech').flush(makeTagEntity('tech'));
    httpMock
      .expectOne((r) => r.url.startsWith('/api/v1/timelines/tag/tech'))
      .flush([makeStatus('1'), makeStatus('2')]);

    fixture.componentInstance.onDeleted(makeStatus('1'));
    expect(
      internals(fixture)
        .statuses()
        .map((s) => s.id),
    ).toEqual(['2']);
  });
});
