import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../../auth';
import { BlueskySession } from '../../providers/bluesky/bluesky-session';
import { environment } from '../../../environments/environment';

/**
 * Sign in with Bluesky, as the app's **primary identity**.
 *
 * Distinct from Settings → Connections → Bluesky, which links Bluesky as a
 * *connector* under an existing Mastodon or Anonymous account. Same credentials,
 * same `createSession` call, different meaning: here Bluesky *is* who you are,
 * and the app has no Mastodon account at all until Sprint 4 attaches one.
 */
@Component({
  selector: 'app-login-bluesky',
  imports: [FormsModule, RouterLink],
  templateUrl: './login-bluesky.html',
  styleUrl: './login-bluesky.css',
})
export class LoginBluesky implements OnInit {
  private auth = inject(Auth);
  private bsky = inject(BlueskySession);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private adding = false;

  protected brand = environment.brand;

  protected handle = signal('');
  protected appPassword = signal('');
  protected working = signal(false);
  protected error = signal<string | null>(null);
  /** Set when the failure looks like a self-hosted PDS rather than bad credentials. */
  protected selfHostedHint = signal(false);

  ngOnInit(): void {
    this.adding = this.route.snapshot.queryParamMap.has('add');
    // Already signed in and not explicitly adding an account: nothing to do here.
    if (this.auth.isAuthenticated && !this.adding) {
      void this.router.navigateByUrl('/home', { replaceUrl: true });
    }
  }

  submit(): void {
    const identifier = this.handle().trim().replace(/^@/, '');
    const password = this.appPassword();
    if (!identifier || !password || this.working()) {
      return;
    }
    this.working.set(true);
    this.error.set(null);
    this.selfHostedHint.set(false);

    this.bsky.loginAsIdentity(identifier, password).subscribe({
      next: () => {
        // The identity is in storage; this makes it the active account. Order
        // matters: enterBluesky() reads the identity back out of storage and
        // refuses to activate a kind it cannot serve.
        const entered = this.auth.enterBluesky();
        this.working.set(false);
        if (!entered) {
          this.error.set(
            'Signed in, but this browser could not store the session. Check whether storage is blocked for this site.',
          );
          return;
        }
        // Clear the password from memory the moment it is no longer needed.
        this.appPassword.set('');
        if (this.adding) {
          // Services chose their account scope when Angular constructed them.
          // A hard navigation rebuilds the app under the newly active DID.
          location.assign('home');
        } else {
          void this.router.navigateByUrl('/home');
        }
      },
      error: (err: unknown) => {
        this.working.set(false);
        this.error.set(this.describe(err, identifier));
      },
    });
  }

  /**
   * Turn a failed `createSession` into something actionable.
   *
   * The self-hosted case earns its own message. `BSKY_SERVICE` is fixed at
   * `bsky.social`, which is an *entryway* — it authenticates every account whose
   * PDS Bluesky operates, which is nearly all of them. Someone running their own
   * PDS cannot authenticate there at all, and telling them "wrong handle or app
   * password" would send them to re-check credentials that are perfectly correct.
   * A handle on a non-`bsky.social` domain is not proof of self-hosting (custom
   * domains on Bluesky's own PDS are common and work fine), so this is only
   * offered as a possibility, after the likelier explanation.
   */
  private describe(err: unknown, identifier: string): string {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    const body = err instanceof HttpErrorResponse ? err.error : null;
    const tag = typeof body?.error === 'string' ? body.error : '';

    if (status === 429 || tag === 'RateLimitExceeded') {
      return 'Bluesky is rate-limiting sign-in attempts from this browser. Wait a few minutes and try again.';
    }
    if (status === 400 || status === 401) {
      if (!identifier.endsWith('.bsky.social') && identifier.includes('.')) {
        this.selfHostedHint.set(true);
      }
      return 'That handle and app password combination was rejected.';
    }
    if (status === 0) {
      return 'Could not reach Bluesky. Check your connection — a content blocker or extension may also be blocking the request.';
    }
    return 'Sign-in failed. Please try again.';
  }
}
