import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { StatusCard } from '../../status-card/status-card';
import { Status } from '../../models';
import { externalFetch } from '../../providers/external-fetch';
import {
  messageStatus,
  parseMessageParams,
} from '../../providers/paste/message-payload';

interface IsgdForwardResponse {
  url?: string;
  errormessage?: string;
}

/**
 * Landing page for a message shared as an is.gd short link.
 *
 * Two ways in:
 *  - Direct target: /message/?m=…&cw=…  (the URL is.gd redirects to). We decode
 *    the params straight into a status — no network needed.
 *  - Short code: /message/?s=<code>. Someone pasted the is.gd code itself, so we
 *    expand it via is.gd's CORS-open forward.php, then decode the target.
 *
 * Deliberately outside the auth shell so a shared link opens for anyone.
 */
@Component({
  selector: 'app-message',
  imports: [StatusCard, RouterLink],
  templateUrl: './message.html',
  styleUrl: './message.css',
})
export class MessagePage implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  protected status = signal<Status | null>(null);
  protected loading = signal(true);
  protected error = signal<string | null>(null);
  protected readonly empty = computed(() => !this.loading() && !this.status() && !this.error());

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('s');
    if (code) {
      this.expandAndRender(code);
    } else {
      this.render(params, this.selfUrl(params));
      this.loading.set(false);
    }
  }

  private render(params: URLSearchParams, sourceUrl: string | null): void {
    const payload = parseMessageParams(params);
    this.status.set(payload ? messageStatus(payload, sourceUrl) : null);
  }

  private expandAndRender(code: string): void {
    // is.gd and v.gd share link codes; the short link's own host is unknown here,
    // so ask is.gd to resolve it. forward.php returns the original target URL.
    const httpParams = new HttpParams().set('format', 'json').set('shorturl', code);
    this.http
      .get<IsgdForwardResponse>('https://is.gd/forward.php', {
        params: httpParams,
        context: externalFetch(),
      })
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          if (!response.url) {
            this.error.set('That short link could not be found.');
            return;
          }
          try {
            const target = new URL(response.url);
            this.render(target.searchParams, response.url);
          } catch {
            this.error.set('That short link does not point to a readable message.');
          }
        },
        error: () => {
          this.loading.set(false);
          this.error.set('The link could not be resolved — is.gd may be unreachable or rate-limited.');
        },
      });
  }

  /** The canonical /message/ URL for these params, used as the post's permalink. */
  private selfUrl(params: URLSearchParams): string | null {
    if (params.get('m') === null) return null;
    try {
      return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    } catch {
      return null;
    }
  }
}
