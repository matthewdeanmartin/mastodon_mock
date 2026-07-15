import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { EXTERNAL_FETCH } from './providers/external-fetch';
import { ServerHealth } from './server-health';

/**
 * Watches API traffic to drive the fail-whale overlay.
 *
 * A network failure (status 0) or a 5xx marks the server down. Anything the
 * server actually answered with — including 401/403 (log in) and 4xx — is a
 * normal response and clears the down state. A successful response clears it
 * too, so the whale disappears the moment traffic recovers.
 */
export const healthInterceptor: HttpInterceptorFn = (req, next) => {
  // Foreign-host fetches (RSS feeds etc.) say nothing about the instance's health.
  if (req.context.get(EXTERNAL_FETCH)) {
    return next(req);
  }
  const health = inject(ServerHealth);
  return next(req).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          health.markUp();
        }
      },
      error: (err) => {
        if (err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500)) {
          health.markDown();
        } else {
          // The server answered (4xx, auth, etc.) — it is reachable.
          health.markUp();
        }
      },
    }),
  );
};
