import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Server } from './server';

/** Prefix relative API/OAuth requests with the currently selected instance base URL. */
export const serverInterceptor: HttpInterceptorFn = (req, next) => {
  const baseUrl = inject(Server).baseUrl();
  if (!baseUrl || !req.url.startsWith('/')) {
    return next(req);
  }
  return next(req.clone({ url: `${baseUrl}${req.url}` }));
};
