import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Server } from '../../server';
import { AppFooter } from '../../shell/app-footer/app-footer';

/**
 * The "come back and sign in" landing page for brand-new users.
 *
 * Signing up happens on the instance's own site, and — because this is an OAuth client with
 * no server of its own — nothing redirects the user back here afterward. So before we send
 * them off to create an account, we route them through this page: it tells them to bookmark
 * us, then return and hit "sign in" once their account exists. The chosen instance rides
 * along in a ?server= param (and is already persisted in the Server service), so the sign-in
 * button lands them straight on the right instance's OAuth screen.
 */
@Component({
  selector: 'app-welcome-back',
  imports: [AppFooter],
  templateUrl: './welcome-back.html',
  styleUrl: './welcome-back.css',
})
export class WelcomeBack {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private server = inject(Server);

  /** The instance the user is signing up on: from ?server=, falling back to the stored one. */
  protected serverHost = computed(() => {
    const fromQuery = this.route.snapshot.queryParamMap.get('server');
    const base = fromQuery || this.server.baseUrl();
    return base.replace(/^https?:\/\//, '') || 'your server';
  });

  /** The instance's own signup page, opened in a new tab. */
  protected signupUrl = computed(() => {
    const base =
      this.route.snapshot.queryParamMap.get('server') || this.server.baseUrl();
    return base ? `${base}/auth/sign_up` : null;
  });

  /** Whether this browser can add bookmarks with a keystroke hint (Ctrl/⌘+D everywhere). */
  protected bookmarkHint = /Mac/i.test(navigator.platform) ? '⌘ + D' : 'Ctrl + D';

  /** Head to the login page, which will start OAuth against the already-chosen instance. */
  goSignIn(): void {
    void this.router.navigate(['/login']);
  }
}
