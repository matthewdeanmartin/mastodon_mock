import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

const PREFIX = '[Mockingbird Home]';

/** Token-safe browser-console diagnostics for the Home feed pipeline. */
@Injectable({ providedIn: 'root' })
export class HomeDiagnostics {
  info(event: string, details: Record<string, unknown> = {}): void {
    console.info(`${PREFIX} ${event}`, details);
  }

  warn(event: string, details: Record<string, unknown> = {}): void {
    console.warn(`${PREFIX} ${event}`, details);
  }

  error(event: string, error: unknown, details: Record<string, unknown> = {}): void {
    console.error(`${PREFIX} ${event}`, { ...details, failure: this.describeFailure(error) });
  }

  /** Never include response bodies, request headers, tokens, account data, or post content. */
  private describeFailure(error: unknown): Record<string, unknown> {
    if (error instanceof HttpErrorResponse) {
      return {
        kind: 'http',
        status: error.status,
        statusText: error.statusText,
        url: error.url,
        message: error.message,
      };
    }
    if (error instanceof Error) {
      return { kind: error.name, message: error.message };
    }
    return { kind: typeof error, message: String(error) };
  }
}
