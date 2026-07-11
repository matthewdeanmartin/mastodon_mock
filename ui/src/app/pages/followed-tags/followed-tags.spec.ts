import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FeaturedTag, Tag } from '../../models';
import { FollowedTags } from './followed-tags';

/** Exposes FollowedTags' protected signals for white-box testing. */
interface FollowedTagsInternals {
  followed: WritableSignal<Tag[]>;
  featured: WritableSignal<FeaturedTag[]>;
  loading: WritableSignal<boolean>;
  load(): void;
  unfollow(tag: Tag): void;
}

function internals(fixture: ComponentFixture<FollowedTags>): FollowedTagsInternals {
  return fixture.componentInstance as unknown as FollowedTagsInternals;
}

function makeTag(name: string): Tag {
  return {
    id: name,
    name,
    url: `https://example.com/tags/${name}`,
    following: true,
    featuring: false,
    history: [],
  };
}

function makeFeaturedTag(id: string, name: string): FeaturedTag {
  return {
    id,
    name,
    url: `https://example.com/tags/${name}`,
    statuses_count: 0,
    last_status_at: null,
  };
}

describe('FollowedTags', () => {
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

  function setUp(): ComponentFixture<FollowedTags> {
    const fixture = TestBed.createComponent(FollowedTags);
    fixture.detectChanges();
    return fixture;
  }

  /** Flush both parallel requests made on init/load. */
  function flushLoad(followed: Tag[], featured: FeaturedTag[]): void {
    httpMock.expectOne('/api/v1/followed_tags').flush(followed);
    httpMock.expectOne('/api/v1/featured_tags').flush(featured);
  }

  it('starts with loading=true and empty signal values', () => {
    const fixture = setUp();
    expect(internals(fixture).loading()).toBe(true);
    expect(internals(fixture).followed()).toEqual([]);
    expect(internals(fixture).featured()).toEqual([]);
    flushLoad([], []);
  });

  it('populates followed tags and clears loading on successful fetch', () => {
    const fixture = setUp();
    const t1 = makeTag('cats');
    const t2 = makeTag('dogs');

    flushLoad([t1, t2], []);

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).followed()).toEqual([t1, t2]);
  });

  it('populates featured tags independently from followed tags', () => {
    const fixture = setUp();
    const f1 = makeFeaturedTag('10', 'rust');

    flushLoad([], [f1]);

    expect(internals(fixture).featured()).toEqual([f1]);
  });

  it('clears loading on HTTP error for followed_tags', () => {
    const fixture = setUp();

    httpMock.expectOne('/api/v1/followed_tags').error(new ProgressEvent('error'));
    httpMock.expectOne('/api/v1/featured_tags').flush([]);

    expect(internals(fixture).loading()).toBe(false);
  });

  it('unfollow() POSTs to /api/v1/tags/:name/unfollow and removes tag from followed', () => {
    const fixture = setUp();
    const t1 = makeTag('cats');
    const t2 = makeTag('dogs');
    flushLoad([t1, t2], []);

    internals(fixture).unfollow(t1);

    httpMock.expectOne('/api/v1/tags/cats/unfollow').flush({ ...t1, following: false });

    expect(internals(fixture).followed()).toEqual([t2]);
  });

  it('unfollow() does not remove other tags', () => {
    const fixture = setUp();
    const t1 = makeTag('cats');
    const t2 = makeTag('dogs');
    const t3 = makeTag('birds');
    flushLoad([t1, t2, t3], []);

    internals(fixture).unfollow(t2);

    httpMock.expectOne('/api/v1/tags/dogs/unfollow').flush({ ...t2, following: false });

    expect(internals(fixture).followed()).toEqual([t1, t3]);
  });

  it('load() re-fetches followed_tags and featured_tags', () => {
    const fixture = setUp();
    flushLoad([], []);

    internals(fixture).load();
    expect(internals(fixture).loading()).toBe(true);

    const t1 = makeTag('rust');
    const f1 = makeFeaturedTag('10', 'rust');
    httpMock.expectOne('/api/v1/followed_tags').flush([t1]);
    httpMock.expectOne('/api/v1/featured_tags').flush([f1]);

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).followed()).toEqual([t1]);
    expect(internals(fixture).featured()).toEqual([f1]);
  });
});
