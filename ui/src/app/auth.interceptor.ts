import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Auth } from './auth';
import { EXTERNAL_FETCH } from './providers/external-fetch';

/** Attach the bearer token to every API request. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Never send the Mastodon token to foreign hosts (RSS feeds etc.).
  if (req.context.get(EXTERNAL_FETCH)) {
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
