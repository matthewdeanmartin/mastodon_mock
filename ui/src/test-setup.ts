import { beforeEach, vi } from 'vitest';

// The default 5s per-test timeout flakes on loaded machines — component-heavy
// specs (full Shell, StatusCard) intermittently exceed it under worker
// contention even though the work is synchronous. Nothing here legitimately
// waits, so a generous ceiling only affects genuinely hung tests.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The pristine `window.location`, captured before any spec has run.
 *
 * Stashed on `globalThis` rather than in a module const because the Angular
 * unit-test builder can execute this setup file more than once per worker; a
 * plain const would be re-captured on the second execution, by which point an
 * earlier spec may already have replaced `location`.
 */
const PRISTINE_LOCATION = '__mockingbirdPristineLocation';
const realm = globalThis as Record<string, unknown>;
realm[PRISTINE_LOCATION] ??= Object.getOwnPropertyDescriptor(window, 'location');

/**
 * Put the real `location` back.
 *
 * Spec files share one jsdom realm (the builder sets `isolate: false` "to align
 * with the Karma/Jasmine experience"), so `window.location` is shared mutable
 * state. Swapping it for a stub is the usual way to intercept a redirect
 * without navigating, but a stub that is never removed outlives its own file:
 * every later file in that worker then sees a `location` with no `origin`, and
 * anything building an absolute URL breaks — `new URL(path, location.origin)`
 * throws, `${location.origin}` interpolates "undefined".
 *
 * The victim is whichever file the runner happened to schedule next in that
 * worker, which is why this presented as three unrelated specs (rate-limit,
 * streaming, right-rail) failing wholesale on roughly 40% of runs, never in
 * isolation, and never the spec that actually caused it.
 *
 * Restoring before every test confines a forgotten cleanup to the one test that
 * did it, so the failure lands on the culprit instead of a stranger.
 */
function restoreLocation(): void {
  const pristine = realm[PRISTINE_LOCATION] as PropertyDescriptor | undefined;
  if (!pristine) {
    return;
  }
  const current = Object.getOwnPropertyDescriptor(window, 'location');
  if (current?.value === pristine.value) {
    return;
  }
  if (current && !current.configurable) {
    // A stub installed without `configurable: true` can only be displaced by
    // assignment, and only if it left itself writable.
    if (current.writable) {
      (window as unknown as { location: unknown }).location = pristine.value;
    }
    return;
  }
  Object.defineProperty(window, 'location', pristine);
}

// Spec files can share a jsdom realm (vitest worker reuse), so Web Storage written
// by one file leaks into the next: e.g. shell.spec saves sessions whose `server`
// points at another instance, which makes a later file's same-origin HTTP
// expectations miss. Clear storage before every test so each starts from the
// clean-browser state the specs assume.
beforeEach(() => {
  restoreLocation();
  localStorage.clear();
  sessionStorage.clear();
});
