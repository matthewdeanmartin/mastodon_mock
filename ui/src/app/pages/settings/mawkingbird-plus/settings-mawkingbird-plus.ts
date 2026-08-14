import { Component, computed, inject, OnInit } from '@angular/core';
import { displayName, WorkosSession } from '../../../providers/workos/workos-session';

/**
 * Settings → Mawkingbird Plus.
 *
 * Today this page does one thing: sign in, show who you are, sign out. It is
 * named for what it will become rather than what it currently is, because the
 * account exists to hang paid features off later and renaming a settings tab
 * costs users their bearings.
 *
 * The account is deliberately free and deliberately optional. Nothing in the
 * app requires one — the CORS proxy stays anonymous, feeds keep working signed
 * out — so this page has to be honest that there is currently nothing to gain
 * by signing in. Overselling it now would be the kind of thing that makes the
 * later, real pitch untrustworthy.
 *
 * The redirect lands back *here*, and the SDK completes the exchange during
 * {@link WorkosSession.ensureReady} — see the class doc there for why there is
 * no callback route.
 */
@Component({
  selector: 'app-settings-mawkingbird-plus',
  templateUrl: './settings-mawkingbird-plus.html',
  styleUrl: './settings-mawkingbird-plus.css',
})
export class SettingsMawkingbirdPlus implements OnInit {
  protected session = inject(WorkosSession);

  /** The signed-in user's name, or null when they never supplied one. */
  protected readonly name = computed(() => {
    const user = this.session.user();
    return user ? displayName(user) : null;
  });

  ngOnInit(): void {
    // Also completes a pending sign-in redirect, since this page is the
    // redirect target. Deliberately not awaited: the template renders a
    // loading state from `ready()` and errors land in `error()`.
    void this.session.ensureReady();
  }
}
