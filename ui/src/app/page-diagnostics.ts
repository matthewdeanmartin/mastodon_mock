import { Injectable } from '@angular/core';

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
