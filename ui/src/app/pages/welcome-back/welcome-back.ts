import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Server } from '../../server';
import { AppFooter } from '../../shell/app-footer/app-footer';

// i18n pagesWelcomeBack.eyebrow: Almost there
// i18n pagesWelcomeBack.heading: Create your account on <strong>{{server}}</strong>
// i18n pagesWelcomeBack.lead: Your account is created on the server itself — a client like this should never handle your email or password. That means <strong>{{server}}</strong> won't send you back here automatically. Here's the two-step plan:
// i18n pagesWelcomeBack.step1.title: Bookmark this page
// i18n pagesWelcomeBack.step1.body: Press <kbd>{{hint}}</kbd> now so you can find your way back after signing up. This is the page you'll return to.
// i18n pagesWelcomeBack.step2.title: Sign up on {{server}}
// i18n pagesWelcomeBack.step2.body: We'll open its sign-up page in a new tab. Finish creating and confirming your account there, then come back to this tab.
// i18n pagesWelcomeBack.step2.open: Open {{server}} sign-up ↗
// i18n pagesWelcomeBack.done.prompt: Account created and confirmed? Come back here and sign in:
// i18n pagesWelcomeBack.done.signIn: I'm signed up — sign in
// i18n pagesWelcomeBack.helper.stillChoosing: Still choosing a server?
// i18n pagesWelcomeBack.helper.browse: Browse servers on joinmastodon.org ↗

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
  imports: [AppFooter, TranslocoPipe],
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
    const base = this.route.snapshot.queryParamMap.get('server') || this.server.baseUrl();
    return base ? `${base}/auth/sign_up` : null;
  });

  /** Whether this browser can add bookmarks with a keystroke hint (Ctrl/⌘+D everywhere). */
  protected bookmarkHint = /Mac/i.test(navigator.platform) ? '⌘ + D' : 'Ctrl + D';

  /**
   * Head to the Mastodon login page, which will start OAuth against the
   * already-chosen instance. Skips the network chooser deliberately: this whole
   * page is about picking and signing up to a Mastodon server.
   */
  goSignIn(): void {
    void this.router.navigate(['/login/mastodon']);
  }
}
