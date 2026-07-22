import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../auth';
import { probeServerAvailability } from '../../server-availability';

/** Shareable entry point that activates the local Anonymous account. */
@Component({
  selector: 'app-anonymous-entry',
  template: '',
})
export class AnonymousEntry implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);

  async ngOnInit(): Promise<void> {
    const result = await probeServerAvailability('https://mastodon.social');
    if (result.status !== 'available') {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    this.auth.enterAnonymous('https://mastodon.social');
    await this.router.navigateByUrl('/home', { replaceUrl: true });
  }
}
