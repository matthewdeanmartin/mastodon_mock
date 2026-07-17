import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Status, Tag } from '../models';
import { externalFetch } from '../providers/external-fetch';

/** The public instance demo mode reads from. Never the mock, never the user's server. */
export const DEMO_SERVER = 'https://mastodon.social';

/**
 * Read-only sample data for the logged-out demo, kept completely separate from
 * {@link Api}: every request is pinned to {@link DEMO_SERVER} with an absolute
 * URL (the server interceptor only rewrites relative ones) and marked external,
 * so no bearer token is ever attached and a hiccup here never trips the
 * fail-whale. Both endpoints are public on mastodon.social — no account, no
 * app registration, nothing to host.
 */
@Injectable({ providedIn: 'root' })
export class DemoFeed {
  private http = inject(HttpClient);

  /** Curated, moderated sample: the instance's trending posts. */
  trendingStatuses(offset = 0): Observable<Status[]> {
    let params = new HttpParams().set('limit', '20');
    if (offset > 0) {
      params = params.set('offset', String(offset));
    }
    return this.http.get<Status[]>(`${DEMO_SERVER}/api/v1/trends/statuses`, {
      params,
      context: externalFetch(),
    });
  }

  /** Trending hashtags, used as chips over the live tag feed. */
  trendingTags(): Observable<Tag[]> {
    return this.http.get<Tag[]>(`${DEMO_SERVER}/api/v1/trends/tags`, {
      params: new HttpParams().set('limit', '10'),
      context: externalFetch(),
    });
  }

  /**
   * Live posts for one hashtag; page older with `maxId`. (The instance's full
   * public firehose needs an authenticated user on mastodon.social, but tag
   * timelines stay anonymous.)
   */
  tagTimeline(tag: string, maxId?: string): Observable<Status[]> {
    let params = new HttpParams().set('limit', '20');
    if (maxId) {
      params = params.set('max_id', maxId);
    }
    return this.http.get<Status[]>(
      `${DEMO_SERVER}/api/v1/timelines/tag/${encodeURIComponent(tag)}`,
      { params, context: externalFetch() },
    );
  }
}
