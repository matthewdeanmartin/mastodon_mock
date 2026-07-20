import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { EXTERNAL_FETCH } from '../providers/external-fetch';
import { Server } from '../server';
import { ApiMetrics } from './api-metrics';

/**
 * Times every instance API call and folds it into {@link ApiMetrics} for the
 * Observability page. Foreign-host fetches (RSS feeds etc.) are skipped — they
 * aren't the instance's traffic.
 *
 * Uses `performance.now()` for a monotonic duration unaffected by clock changes.
 */
export const metricsInterceptor: HttpInterceptorFn = (req, next) => {
  const server = inject(Server);
  if (req.context.get(EXTERNAL_FETCH) && !targetsActiveServer(req.url, server.baseUrl())) {
    return next(req);
  }
  const metrics = inject(ApiMetrics);
  const start = performance.now();
  return next(req).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          metrics.record(req.method, req.url, performance.now() - start, event.status, true);
        }
      },
      error: (err) => {
        const status = err instanceof HttpErrorResponse ? err.status : 0;
        const ok = status >= 200 && status < 400;
        metrics.record(req.method, req.url, performance.now() - start, status, ok);
      },
    }),
  );
};

function targetsActiveServer(url: string, baseUrl: string): boolean {
  if (url.startsWith('/')) {
    return true;
  }
  if (!baseUrl) {
    return false;
  }
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
