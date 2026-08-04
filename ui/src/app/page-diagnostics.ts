import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

/**
 * The HTTP status behind a failure, for log details.
 *
 * The status is the single most useful field when reading a report after the
 * fact: 503 (the instance is unwell, try again later) and 404 (you don't follow
 * that account) call for completely different next steps, and "it didn't work"
 * distinguishes neither. `null` for anything that isn't an HTTP failure.
 */
export function statusOf(err: unknown): number | null {
  return err instanceof HttpErrorResponse ? err.status : null;
}

/** Low-volume, production-visible console events for page loads and user actions. */
@Injectable({ providedIn: 'root' })
export class PageDiagnostics {
  info(area: string, event: string, details: Record<string, unknown> = {}): void {
    console.info(`[Mockingbird ${area}] ${event}`, details);
  }

  warn(area: string, event: string, details: Record<string, unknown> = {}): void {
    console.warn(`[Mockingbird ${area}] ${event}`, details);
  }

  error(area: string, event: string, error: unknown, details: Record<string, unknown> = {}): void {
    console.error(`[Mockingbird ${area}] ${event}`, { ...details, error });
  }
}
