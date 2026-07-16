import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ErrorLog } from './error-log';
import { UpdateRecovery } from './update-recovery';

/**
 * Root {@link ErrorHandler}. Beyond the default it does two things:
 *
 *  1. Routes a deployment-caused chunk-load failure into {@link UpdateRecovery}
 *     (reload once to pick up the new bundle) instead of surfacing it as an
 *     unexplained crash.
 *  2. Records every error into the {@link ErrorLog} ring buffer so the bug
 *     reporter can show the user what broke — the fix for "the app died and I
 *     never even got a message."
 *
 * Paired with `provideBrowserGlobalErrorListeners()` in `appConfig`, which
 * forwards window `error` and `unhandledrejection` events here — important
 * because a failed dynamic import arrives as a rejected promise, and it means
 * this handler sees window-level errors too, not just Angular ones.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly recovery = inject(UpdateRecovery);
  private readonly errorLog = inject(ErrorLog);

  handleError(error: unknown): void {
    this.errorLog.record('angular', error);
    if (this.recovery.recover(error)) {
      return;
    }
    console.error(error);
  }
}
