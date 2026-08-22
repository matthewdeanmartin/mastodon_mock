import { Injectable, signal } from '@angular/core';

/**
 * Reading zen: the rails hidden for as long as reader mode is open.
 *
 * The third of the three zen states, and the only transient one that leaves the
 * saved preference alone:
 *
 * | | Global zen (`ClientPrefs.zenMode`) | Writing zen | Reading zen (this) |
 * | --- | --- | --- | --- |
 * | Scope | the whole app | the writing surface | the rails |
 * | Lifetime | a persisted preference | this visit | while reader mode is open |
 * | Hides | the rails | everything | the rails |
 *
 * Reader mode wants exactly what global zen does — the rails gone — but it must
 * not *become* global zen. Writing `prefs.setZenMode(true)` on entry and `false`
 * on exit would silently un-set the preference of someone who had zen on
 * already, and persist it, so one visit to an article would reconfigure the app
 * for good. Instead the shell reads "zen if the preference says so **or** a hold
 * is out", and reader mode takes and releases a hold. The preference is never
 * written, so restoring it on exit is not a step that can go wrong: there is
 * nothing to restore.
 *
 * Counted rather than boolean. Two overlapping holders — a reader-mode thread
 * and anything later that wants the same effect — would otherwise have the
 * first one to leave turn the rails back on underneath the second.
 */
@Injectable({ providedIn: 'root' })
export class ReadingZen {
  private readonly holds = signal(0);

  /** Whether anything currently wants the rails hidden for reading. */
  readonly active = signal(false);

  /**
   * Take a hold. Returns a release function that is safe to call more than
   * once — a page releasing on both "reader closed" and "component destroyed"
   * is the normal case, not a bug to guard against at the call site.
   */
  hold(): () => void {
    this.holds.update((n) => n + 1);
    this.active.set(true);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.holds.update((n) => Math.max(0, n - 1));
      this.active.set(this.holds() > 0);
    };
  }

  /** Drop every hold. For tests and for a hard navigation reset. */
  reset(): void {
    this.holds.set(0);
    this.active.set(false);
  }
}
