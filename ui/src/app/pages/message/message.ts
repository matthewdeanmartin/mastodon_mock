import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StatusCard } from '../../status-card/status-card';
import { Status } from '../../models';
import { messageStatus, parseMessageParams } from '../../providers/paste/message-payload';

/**
 * Landing page for a message shared as a short link.
 *
 * A shortener stores the redirect target, so opening a tinyurl.com/xxxx link
 * 301-redirects straight here to /message/?m=…&cw=… . We decode those params
 * into a Mastodon status — no network needed. (There's deliberately no expand
 * step: TinyURL has no CORS-open resolve API, and the redirect already delivers
 * the target, so a bare short code is never handed to this page.)
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
  protected status = signal<Status | null>(null);

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const payload = parseMessageParams(params);
    this.status.set(payload ? messageStatus(payload, this.selfUrl(params)) : null);
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
