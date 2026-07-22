import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { HOUSE_ADS } from '../../house-ads';
import { InstanceInfo } from '../../models';
import { Server } from '../../server';

/**
 * Right sidebar: house ads (inventory lives in house-ads.ts — edit that file to
 * change them), then the Fediverse card — server-feed entry points (which now
 * route into the Lists tab, not /explore), ways to give back (your own server,
 * the Mastodon project), server info.
 * Trends moved to the left rail under "Who to follow".
 */
@Component({
  selector: 'app-right-rail',
  imports: [RouterLink],
  templateUrl: './right-rail.html',
  styleUrl: './right-rail.css',
})
export class RightRail {
  private api = inject(Api);
  private auth = inject(Auth);
  private server = inject(Server);

  protected ads = HOUSE_ADS;

  protected instance = signal<InstanceInfo | null>(null);

  /**
   * The host of the user's home server, inferred from their account (the part
   * after "@" in acct, when present), falling back to the instance the client
   * is pointed at, then to the connected server's self-reported domain.
   */
  protected homeHost = computed<string | null>(() => {
    const acct = this.auth.account()?.acct ?? '';
    const at = acct.indexOf('@');
    if (at > 0) {
      return acct.slice(at + 1);
    }
    const base = this.server.baseUrl();
    if (base) {
      return base.replace(/^https?:\/\//, '');
    }
    return this.instance()?.domain ?? null;
  });

  /** The user's server's /about page, where Mastodon instances put donation info. */
  protected donateServerUrl = computed<string>(() => {
    const host = this.homeHost();
    return host ? `https://${host}/about` : '/about';
  });

  constructor() {
    // Runs on init and again when the user switches accounts or instances, so
    // the server-info block and donate link don't go stale mid-session.
    effect(() => {
      this.auth.account();
      this.server.baseUrl();
      this.fetchInstance();
    });
  }

  private fetchInstance(): void {
    this.api.instanceInfo().subscribe({
      next: (info) => this.instance.set(info),
      error: () => {
        // Sidebar widget: fail silently.
      },
    });
  }
}
