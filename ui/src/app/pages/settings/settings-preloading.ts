import { Injectable, signal } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of } from 'rxjs';

/**
 * Preloads settings component code after the settings area has been opened once.
 *
 * Route preloading only resolves `loadComponent`; it does not instantiate the
 * component, so lifecycle hooks and their API requests still wait for activation.
 */
@Injectable({ providedIn: 'root' })
export class SettingsPreloading implements PreloadingStrategy {
  private readonly enabled = signal(false);

  enable(): void {
    this.enabled.set(true);
  }

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    return this.enabled() && route.data?.['preloadSettings'] === true ? load() : of(null);
  }
}
