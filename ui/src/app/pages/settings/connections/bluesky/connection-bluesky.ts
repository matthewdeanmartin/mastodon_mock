import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { BlueskySession } from '../../../../providers/bluesky/bluesky-session';
import { AnonymousCapabilities } from '../../../../providers/anonymous/anonymous-capabilities';
import { expiryLabel } from '../expiry-label';

/** Settings → Connections → Bluesky. App-password link; the only read/write connector. */
@Component({
  selector: 'app-connection-bluesky',
  imports: [FormsModule, RouterLink],
  templateUrl: './connection-bluesky.html',
  styleUrls: ['../connection-page.css', './connection-bluesky.css'],
})
export class ConnectionBluesky implements OnInit {
  protected capabilities = inject(AnonymousCapabilities);
  protected bsky = inject(BlueskySession);

  protected bskyHandle = signal('');
  protected bskyPassword = signal('');
  protected bskyLinking = signal(false);
  protected bskyError = signal<string | null>(null);

  protected readonly expiryLabel = expiryLabel;

  ngOnInit(): void {
    // Deep-link case: re-check against a policy shortened on the catalog page.
    this.bsky.enforceLifetime();
  }

  linkBluesky(): void {
    const handle = this.bskyHandle().trim().replace(/^@/, '');
    const password = this.bskyPassword();
    if (!handle || !password || this.bskyLinking()) {
      return;
    }
    this.bskyLinking.set(true);
    this.bskyError.set(null);
    this.bsky.login(handle, password).subscribe({
      next: () => {
        this.bskyLinking.set(false);
        this.bskyHandle.set('');
        this.bskyPassword.set('');
      },
      error: (err: unknown) => {
        this.bskyLinking.set(false);
        this.bskyError.set(describeBskyError(err));
      },
    });
  }

  unlinkBluesky(): void {
    this.bsky.unlink();
  }
}

function describeBskyError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 401) {
      return 'Bluesky rejected that handle/app password combination.';
    }
    const message = (err.error as { message?: string } | null)?.message;
    if (message) {
      return message;
    }
    if (err.status === 0) {
      return "Couldn't reach bsky.social — network problem?";
    }
  }
  return 'Linking failed — check the handle and app password.';
}
