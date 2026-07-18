import { Route } from '@angular/router';
import { Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPreloading } from './settings-preloading';

describe('SettingsPreloading', () => {
  const markedRoute: Route = { path: 'blue', data: { preloadSettings: true } };

  it('does not load settings bundles before the settings shell enables preloading', () => {
    const strategy = new SettingsPreloading();
    const load = vi.fn<() => Observable<unknown>>(() => of('loaded'));

    strategy.preload(markedRoute, load).subscribe();

    expect(load).not.toHaveBeenCalled();
  });

  it('loads marked settings bundles after preloading is enabled', () => {
    const strategy = new SettingsPreloading();
    const load = vi.fn<() => Observable<unknown>>(() => of('loaded'));
    strategy.enable();

    strategy.preload(markedRoute, load).subscribe();

    expect(load).toHaveBeenCalledOnce();
  });

  it('does not load unrelated lazy routes', () => {
    const strategy = new SettingsPreloading();
    const load = vi.fn<() => Observable<unknown>>(() => of('loaded'));
    strategy.enable();

    strategy.preload({ path: 'home' }, load).subscribe();

    expect(load).not.toHaveBeenCalled();
  });
});
