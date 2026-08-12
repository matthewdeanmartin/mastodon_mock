import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../auth';
import { normalizeHostUrl } from '../../host-url';
import { probeServerAvailability } from '../../server-availability';

/** Shareable entry point that activates the local Anonymous account. */
@Component({
  selector: 'app-anonymous-entry',
  template: '',
})
export class AnonymousEntry implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  async ngOnInit(): Promise<void> {
    // A bare query key makes the share URL pleasantly short:
    // /anonymous?mastodon.social (rather than /anonymous?server=mastodon.social).
    const sharedHost = this.route.snapshot.queryParamMap.keys[0] ?? 'mastodon.social';
    const server = normalizeHostUrl(sharedHost) || 'https://mastodon.social';
    const result = await probeServerAvailability(server);
    if (result.status !== 'available') {
      // The shared server was unreachable, so hand off to `/`, which probes the
      // fallback chain and enters anonymously against whichever server answers.
      // Better than a login form, and better than failing: the visitor asked to
      // read without an account, and they still get to.
      await this.router.navigateByUrl('/', { replaceUrl: true });
      return;
    }
    this.auth.enterAnonymous(server);
    await this.router.navigateByUrl('/home', { replaceUrl: true });
  }
}
