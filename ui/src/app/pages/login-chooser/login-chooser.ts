import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../../auth';
import { ClientPrefs } from '../../client-prefs';

/**
 * "Which network are you on?" — the two-door chooser at `/login`.
 *
 * ## Why this route also forwards OAuth callbacks
 *
 * `/login` is not just an internal route: the Mastodon OAuth flow registers
 * `<base href>login` with the remote instance as its `redirect_uri`, and real
 * instances validate the callback against exactly what was registered. Every
 * app record already created — and every flow in flight right now — points here.
 *
 * So `/login` stays the callback address, and a request carrying `?code=` is
 * forwarded to `/login/mastodon` with its query string intact, because that is
 * the component that owns `handleOAuthCallback`. Re-pointing `redirect_uri` at
 * `/login/mastodon` instead would work for new flows and silently break any
 * that were already under way.
 *
 * `?add=1` deliberately stays on the chooser: adding an account may mean a
 * Mastodon login or a Bluesky alt, and both doors preserve that flag.
 */
@Component({
  selector: 'app-login-chooser',
  imports: [RouterLink, FormsModule],
  templateUrl: './login-chooser.html',
  styleUrl: './login-chooser.css',
})
export class LoginChooser implements OnInit {
  private auth = inject(Auth);
  /** For the analytics opt-out, which lives on the signed-out page by design. */
  protected prefs = inject(ClientPrefs);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected adding = false;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    // Hand OAuth callbacks straight through. `add` alone stays on the chooser.
    if (params.get('code') || params.get('state')) {
      void this.router.navigate(['/login/mastodon'], {
        queryParams: this.route.snapshot.queryParams,
        replaceUrl: true,
      });
      return;
    }
    this.adding = params.has('add');
    // A signed-in visitor who lands here (bookmark, back button) is not asking
    // to pick a network. Same reasoning as the front page.
    if (this.auth.isAuthenticated && !this.adding) {
      void this.router.navigateByUrl('/home', { replaceUrl: true });
    }
  }
}
