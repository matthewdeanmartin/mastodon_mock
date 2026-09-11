import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Auth } from './auth';

/** Attach the bearer token to every API request. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
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
