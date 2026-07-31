import { Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BlueskySession } from '../../../providers/bluesky/bluesky-session';
import { DropboxSession } from '../../../providers/dropbox/dropbox-session';
import { RaindropSession } from '../../../providers/raindrop/raindrop-session';
import { GitHubSession } from '../../../providers/github/github-session';
import { OpenRouterSession } from '../../../providers/openrouter/openrouter-session';
import { CorsProxySettings } from '../../../providers/cors-proxy/cors-proxy-settings';
import { CentosPasteKey } from '../../../providers/paste/centos-key';
import {
  CREDENTIAL_LIFETIME_OPTIONS,
  CredentialLifetime,
  CredentialLifetimeStore,
} from '../../../providers/credential-lifetime';
import {
  CONNECTION_CATALOG,
  CONNECTION_SCOPE_COPY,
  ConnectionCatalogEntry,
} from './connection-catalog';

/** A catalog entry joined to the live state only the injector can supply. */
export interface ConnectionCatalogRow {
  entry: ConnectionCatalogEntry;
  connected: boolean;
  /**
   * Why this connector cannot be used in this build or by this account, or
   * null when it can. An unavailable entry still renders — greyed, with the
   * reason — because a connector that silently vanishes is a support question.
   */
  unavailableReason: string | null;
}

/**
 * Connections: the catalog. Every connector is one account somewhere else, and
 * each gets its own child page under `/settings/connections/<id>` — this page
 * only answers "what is there, what does it get me, is it on?".
 *
 * The credential-retention policy stays here rather than on any child because
 * it governs all of them at once.
 */
@Component({
  selector: 'app-settings-connections',
  imports: [RouterLink],
  templateUrl: './settings-connections.html',
  styleUrl: './settings-connections.css',
})
export class SettingsConnections implements OnInit {
  private bsky = inject(BlueskySession);
  private dropbox = inject(DropboxSession);
  private raindrop = inject(RaindropSession);
  private github = inject(GitHubSession);
  private openrouter = inject(OpenRouterSession);
  private corsProxy = inject(CorsProxySettings);
  // Not a catalog entry — a paste service is a list, not a one-account
  // connector, so its key is managed on the Pastes page. It is governed here
  // anyway, because a stored secret must sit under the same retention policy
  // wherever it was pasted.
  private centosPaste = inject(CentosPasteKey);
  protected lifetimes = inject(CredentialLifetimeStore);

  protected readonly lifetimeOptions = CREDENTIAL_LIFETIME_OPTIONS;
  protected readonly scopeCopy = CONNECTION_SCOPE_COPY;

  /**
   * The catalog joined to live connected/available state.
   *
   * The `switch` is the deliberate cost of keeping `connection-catalog.ts` free
   * of service imports (see the note there). Adding a connector means one entry
   * there and one case here.
   */
  protected readonly rows = computed<ConnectionCatalogRow[]>(() =>
    CONNECTION_CATALOG.map((entry) => {
      switch (entry.id) {
        case 'bluesky':
          // Available to every account including Anonymous: the app password is
          // its own credential and needs no Mastodon token.
          return { entry, connected: this.bsky.session() !== null, unavailableReason: null };
        case 'openrouter':
          return { entry, connected: this.openrouter.connected(), unavailableReason: null };
        case 'raindrop':
          return { entry, connected: this.raindrop.connected(), unavailableReason: null };
        case 'github':
          return { entry, connected: this.github.connected(), unavailableReason: null };
        case 'dropbox':
          return {
            entry,
            connected: this.dropbox.connected(),
            unavailableReason: this.dropbox.configured
              ? null
              : 'Not configured for this build — the Dropbox app key is missing.',
          };
        case 'cors-proxy':
          // "Connected" here means a proxy is selected *and* complete enough to
          // use — a proxy that needs a key and has none is configured, not
          // working, and saying otherwise would explain nothing when a feed
          // still fails.
          return { entry, connected: this.corsProxy.usable(), unavailableReason: null };
      }
    }),
  );

  ngOnInit(): void {
    // Tell the policy store which connectors it governs, then apply the current
    // policy: each session already dropped an over-age credential when it was
    // constructed, but a session built before the user shortened the window (or
    // one whose page has been open a long time) is re-checked here.
    //
    // This is the only page that governs the full set, because it owns the
    // policy picker below. A child page reached by deep link enforces its own
    // session on init instead.
    this.lifetimes.govern([
      this.github,
      this.raindrop,
      this.bsky,
      this.openrouter,
      this.corsProxy,
      this.centosPaste,
    ]);
    this.lifetimes.enforceAll();
  }

  /**
   * Change how long pasted credentials are kept. Shortening the window applies
   * at once, so anything already past the new limit disconnects here rather
   * than surviving until the next reload.
   */
  setLifetime(lifetime: CredentialLifetime): void {
    this.lifetimes.set(lifetime);
  }
}
