# Recovering an Angular Application After a Deployment

> **Status: implemented** (Angular 21, standalone). See `ui/src/app/update-recovery.ts`
> (service + signals), `ui/src/app/global-error-handler.ts` (root `ErrorHandler`),
> `ui/src/app/update-overlay/` (themed "Updating…" / "couldn't finish updating"
> overlay), and the registration in `ui/src/app/app.config.ts`. The service is
> `UpdateRecovery`, the storage key is `mockingbird.update-recovery`, and it exposes
> `updating`/`failed` signals so recovery renders through Angular instead of blanking
> the DOM. `provideBrowserGlobalErrorListeners()` (already present) supplies the
> window `error`/`unhandledrejection` forwarding, so no manual listeners are needed.
> The prose below is the original design note.

When an Angular application is open during a deployment, the browser may still be running the old application bundle. If the user subsequently opens a lazy-loaded route or component, the old application may request a chunk such as:

```text
chunk-I4FB6I3I.js
```

That chunk may have been removed by the new deployment because the generated filename changed. The browser then reports an error such as:

```text
TypeError: error loading dynamically imported module
```

The application should respond by reloading the page once so that the browser receives the new `index.html` and its new bundle references.

The implementation must not reload indefinitely if the deployment is incomplete, the CDN is inconsistent, or the newly loaded application has the same problem.

## 1. Create the recovery service

Create `src/app/chunk-load-recovery.service.ts`:

```ts
import { Injectable } from '@angular/core';

interface RecoveryAttempt {
  attemptedAt: number;
}

@Injectable({
  providedIn: 'root',
})
export class ChunkLoadRecoveryService {
  private readonly storageKey = 'mawkingbird.chunk-load-recovery';
  private readonly recoveryWindowMs = 60_000;
  private readonly stabilizationPeriodMs = 30_000;

  private recoveryStarted = false;

  /**
   * Call once when the Angular application has successfully started.
   *
   * The guard is deliberately not cleared immediately. If the deployment or
   * CDN is inconsistent, the reloaded app may start successfully but fail as
   * soon as it requests another chunk.
   */
  markApplicationStableAfterDelay(): void {
    window.setTimeout(() => {
      this.clearRecoveryAttempt();
    }, this.stabilizationPeriodMs);
  }

  /**
   * Returns true when the supplied value appears to represent a failed
   * JavaScript module or Angular chunk load.
   */
  isChunkLoadError(error: unknown): boolean {
    const message = this.extractErrorText(error).toLowerCase();

    return [
      'error loading dynamically imported module',
      'failed to fetch dynamically imported module',
      'importing a module script failed',
      'chunkloaderror',
      'loading chunk',
      'failed to load module script',
    ].some((fragment) => message.includes(fragment));
  }

  /**
   * Reload once. If another chunk failure occurs during the recovery window,
   * stop and show a stable fallback page instead of entering a reload loop.
   */
  recover(error: unknown): boolean {
    if (!this.isChunkLoadError(error)) {
      return false;
    }

    // Several global error mechanisms can report the same failure. Prevent
    // duplicate handling before the browser actually starts navigating.
    if (this.recoveryStarted) {
      return true;
    }

    this.recoveryStarted = true;

    const previousAttempt = this.readRecoveryAttempt();
    const now = Date.now();

    if (
      previousAttempt !== null &&
      now - previousAttempt.attemptedAt < this.recoveryWindowMs
    ) {
      this.showRecoveryFailurePage();
      return true;
    }

    this.writeRecoveryAttempt({
      attemptedAt: now,
    });

    window.location.reload();
    return true;
  }

  private extractErrorText(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }

    if (error instanceof Error) {
      return `${error.name}: ${error.message}\n${error.stack ?? ''}`;
    }

    if (this.isRecord(error)) {
      const parts: string[] = [];

      if (typeof error['name'] === 'string') {
        parts.push(error['name']);
      }

      if (typeof error['message'] === 'string') {
        parts.push(error['message']);
      }

      // PromiseRejectionEvent and some Angular wrappers place the original
      // error in "reason", "rejection", or "error".
      for (const key of ['reason', 'rejection', 'error']) {
        if (key in error) {
          parts.push(this.extractErrorText(error[key]));
        }
      }

      if (parts.length > 0) {
        return parts.join('\n');
      }

      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    }

    return String(error);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private readRecoveryAttempt(): RecoveryAttempt | null {
    try {
      const serialized = sessionStorage.getItem(this.storageKey);

      if (serialized === null) {
        return null;
      }

      const parsed: unknown = JSON.parse(serialized);

      if (
        this.isRecord(parsed) &&
        typeof parsed['attemptedAt'] === 'number'
      ) {
        return {
          attemptedAt: parsed['attemptedAt'],
        };
      }
    } catch {
      // Storage can be unavailable in hardened or private browser modes.
      // Recovery still works; it simply cannot persist the loop guard.
    }

    return null;
  }

  private writeRecoveryAttempt(attempt: RecoveryAttempt): void {
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(attempt));
    } catch {
      // Do not prevent recovery merely because browser storage is unavailable.
    }
  }

  private clearRecoveryAttempt(): void {
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {
      // Nothing else needs to be done.
    }
  }

  private showRecoveryFailurePage(): void {
    const title = 'Mawkingbird was updated';
    const message =
      'The application could not finish loading the new version. ' +
      'This may be a temporary deployment or caching problem.';

    document.title = title;

    document.body.replaceChildren();

    const main = document.createElement('main');
    main.style.maxWidth = '42rem';
    main.style.margin = '5rem auto';
    main.style.padding = '0 1.5rem';
    main.style.fontFamily = 'system-ui, sans-serif';
    main.style.lineHeight = '1.5';

    const heading = document.createElement('h1');
    heading.textContent = title;

    const paragraph = document.createElement('p');
    paragraph.textContent = message;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Try loading again';
    button.style.padding = '0.7rem 1rem';
    button.style.font = 'inherit';
    button.addEventListener('click', () => {
      this.clearRecoveryAttempt();
      window.location.reload();
    });

    main.append(heading, paragraph, button);
    document.body.append(main);
  }
}
```

## 2. Add a global Angular error handler

Create `src/app/global-error-handler.ts`:

```ts
import { ErrorHandler, Injectable } from '@angular/core';

import { ChunkLoadRecoveryService } from './chunk-load-recovery.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  constructor(
    private readonly chunkRecovery: ChunkLoadRecoveryService,
  ) {}

  handleError(error: unknown): void {
    if (this.chunkRecovery.recover(error)) {
      return;
    }

    // Replace this with the application's normal logging or monitoring
    // integration if one exists.
    console.error(error);
  }
}
```

## 3. Register the handler

For a standalone Angular application, add the provider to `app.config.ts`:

```ts
import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { GlobalErrorHandler } from './global-error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),

    // Forwards browser "error" and "unhandledrejection" events to Angular's
    // ErrorHandler. Use this when available in the installed Angular version.
    provideBrowserGlobalErrorListeners(),

    {
      provide: ErrorHandler,
      useClass: GlobalErrorHandler,
    },
  ],
};
```

`provideBrowserGlobalErrorListeners()` forwards browser `error` and `unhandledrejection` events to Angular’s `ErrorHandler`, which is important because a failed dynamic import is commonly reported as a rejected promise.

For an older NgModule-based application:

```ts
import { ErrorHandler, NgModule } from '@angular/core';

import { GlobalErrorHandler } from './global-error-handler';

@NgModule({
  providers: [
    {
      provide: ErrorHandler,
      useClass: GlobalErrorHandler,
    },
  ],
})
export class AppModule {}
```

Older Angular versions that do not provide `provideBrowserGlobalErrorListeners()` should also install explicit browser listeners as described in the compatibility section below.

## 4. Clear the recovery guard after successful operation

In the root component:

```ts
import { Component, OnInit } from '@angular/core';

import { ChunkLoadRecoveryService } from './chunk-load-recovery.service';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  constructor(
    private readonly chunkRecovery: ChunkLoadRecoveryService,
  ) {}

  ngOnInit(): void {
    this.chunkRecovery.markApplicationStableAfterDelay();
  }
}
```

The guard remains active for 30 seconds after startup.

This produces the following behavior:

```text
Old application requests deleted chunk
              |
              v
       Chunk error detected
              |
              v
 No recent recovery attempt exists
              |
              v
  Record attempt in sessionStorage
              |
              v
          Reload page
              |
              v
 New application runs successfully
              |
              v
 Clear guard after 30 seconds
```

If the reloaded application fails again within 60 seconds:

```text
Reloaded application gets another chunk error
                    |
                    v
      Recent recovery attempt exists
                    |
                    v
        Do not reload automatically
                    |
                    v
         Show recovery fallback
```

The user may then explicitly press **Try loading again**. That button clears the guard before reloading, so the decision to make another attempt belongs to the user rather than an automatic loop.

## 5. Compatibility fallback for older Angular versions

If the installed Angular version does not have `provideBrowserGlobalErrorListeners()`, install the global listeners manually in the root component:

```ts
import {
  Component,
  ErrorHandler,
  OnDestroy,
  OnInit,
} from '@angular/core';

import { ChunkLoadRecoveryService } from './chunk-load-recovery.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly onWindowError = (event: ErrorEvent): void => {
    this.errorHandler.handleError(event.error ?? event.message);
  };

  private readonly onUnhandledRejection = (
    event: PromiseRejectionEvent,
  ): void => {
    this.errorHandler.handleError(event.reason);
  };

  constructor(
    private readonly errorHandler: ErrorHandler,
    private readonly chunkRecovery: ChunkLoadRecoveryService,
  ) {}

  ngOnInit(): void {
    window.addEventListener('error', this.onWindowError);
    window.addEventListener(
      'unhandledrejection',
      this.onUnhandledRejection,
    );

    this.chunkRecovery.markApplicationStableAfterDelay();
  }

  ngOnDestroy(): void {
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener(
      'unhandledrejection',
      this.onUnhandledRejection,
    );
  }
}
```

Use either `provideBrowserGlobalErrorListeners()` or these manual listeners, not both.

## 6. Deployment configuration still matters

The browser must be allowed to retrieve the new `index.html`. Configure hosting so that:

```text
index.html:
    Cache-Control: no-cache
```

or:

```text
index.html:
    Cache-Control: no-cache, no-store, must-revalidate
```

Hashed JavaScript, CSS, and asset files should remain long-lived:

```text
chunk-*.js:
    Cache-Control: public, max-age=31536000, immutable
```

Also prefer atomic deployments:

1. Upload all new hashed assets.
2. Upload the new `index.html` last.
3. Do not delete the previous deployment’s chunks immediately.
4. Retain old hashed chunks for at least several hours, or preferably one or more days.

Keeping old immutable chunks temporarily is the primary defense. Automatic reload recovery is the safety net for users whose tabs remain open longer than the retention period.

## Result

This implementation:

* Detects Firefox’s `error loading dynamically imported module`.
* Covers common Chromium and Angular chunk-load messages.
* Handles both synchronous global errors and rejected dynamic-import promises.
* Automatically reloads only once.
* Avoids a deployment-related infinite reload loop.
* Gives the user a manual recovery option after repeated failure.
* Eventually resets itself so a later, unrelated deployment can recover normally.
