import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RaindropSession } from '../../../../providers/raindrop/raindrop-session';
import { expiryLabel } from '../expiry-label';

/** Settings → Connections → Raindrop.io. Test-token paste; no OAuth (see the copy). */
@Component({
  selector: 'app-connection-raindrop',
  imports: [FormsModule, RouterLink],
  templateUrl: './connection-raindrop.html',
  styleUrls: ['../connection-page.css', './connection-raindrop.css'],
})
export class ConnectionRaindrop implements OnInit {
  protected raindrop = inject(RaindropSession);

  protected raindropToken = signal('');
  protected raindropError = signal<string | null>(null);
  protected raindropNotice = signal<string | null>(null);

  protected readonly expiryLabel = expiryLabel;

  ngOnInit(): void {
    // Deep-link case: re-check against a policy shortened on the catalog page.
    this.raindrop.enforceLifetime();
  }

  connectRaindrop(): void {
    this.raindropError.set(null);
    this.raindropNotice.set(null);
    try {
      this.raindrop.connect(this.raindropToken());
      this.raindropToken.set('');
      this.raindropNotice.set('Raindrop.io connected. Bookmark buttons now offer both providers.');
    } catch (error: unknown) {
      this.raindropError.set(
        error instanceof Error ? error.message : "Couldn't connect Raindrop.io.",
      );
    }
  }

  disconnectRaindrop(): void {
    this.raindrop.disconnect();
    this.raindropNotice.set(null);
  }
}
