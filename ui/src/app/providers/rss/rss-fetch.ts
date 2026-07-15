import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { externalFetch } from '../external-fetch';
import { ParsedFeed, parseFeed } from './rss-parser';

/**
 * Fetches and parses a feed straight from the browser — no proxy, by design.
 * Feeds whose hosts don't send CORS headers simply can't be read here; the
 * error message says so plainly and the user picks a different source.
 */
@Injectable({ providedIn: 'root' })
export class RssFetch {
  private http = inject(HttpClient);

  fetchFeed(url: string): Observable<ParsedFeed> {
    return this.http.get(url, { responseType: 'text', context: externalFetch() }).pipe(
      map((xml) => parseFeed(xml)),
      catchError((err: unknown) => throwError(() => new Error(describe(err)))),
    );
  }
}

function describe(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return (
        "Couldn't reach this feed from the browser. Either the address is wrong or the " +
        "site doesn't allow cross-origin (CORS) access — Mockingbird has no server, so " +
        'only feeds that permit browser access work.'
      );
    }
    return `The feed's server answered ${err.status}.`;
  }
  return err instanceof Error ? err.message : 'Unknown error reading the feed.';
}
