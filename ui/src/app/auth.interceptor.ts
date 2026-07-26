import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Auth } from './auth';
import { EXTERNAL_FETCH } from './providers/external-fetch';
import { SEARCH_SERVER_REQUEST, SearchServer } from './search-server';

/** Attach the bearer token to every API request. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Never send the Mastodon token to foreign hosts (RSS feeds etc.).
  if (req.context.get(EXTERNAL_FETCH)) {
    return next(req);
  }
  // Same reasoning for a separately chosen search server: the token belongs to the
  // primary instance, so search there runs anonymously (results are public-only).
  if (req.context.get(SEARCH_SERVER_REQUEST) && inject(SearchServer).active()) {
    return next(req);
  }
  // Respect a caller-supplied Authorization (e.g. signup uses an app token).
  if (req.headers.has('Authorization')) {
    return next(req);
  }
  const token = inject(Auth).token();
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
