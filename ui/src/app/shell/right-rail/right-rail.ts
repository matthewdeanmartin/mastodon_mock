import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { InstanceInfo } from '../../models';
import { Server } from '../../server';

/**
 * Right sidebar: the Fediverse card — explore entry points, ways to give back
 * (your own server, the Mastodon project, IFTAS trust & safety), server info —
 * and a house ad for MIMB. Trends moved to the left rail under "Who to follow".
 */
@Component({
  selector: 'app-right-rail',
  imports: [RouterLink],
  templateUrl: './right-rail.html',
  styleUrl: './right-rail.css',
})
export class RightRail implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private server = inject(Server);

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

  ngOnInit(): void {
    this.api.instanceInfo().subscribe({
      next: (info) => this.instance.set(info),
      error: () => {
        // Sidebar widget: fail silently.
      },
    });
  }
}
