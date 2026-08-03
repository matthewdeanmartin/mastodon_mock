import { Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BlueskySession } from '../../../providers/bluesky/bluesky-session';
import { DropboxSession } from '../../../providers/dropbox/dropbox-session';
import { RaindropSession } from '../../../providers/raindrop/raindrop-session';
import { GitHubSession } from '../../../providers/github/github-session';
import { OpenRouterSession } from '../../../providers/openrouter/openrouter-session';
import { CorsProxySettings } from '../../../providers/cors-proxy/cors-proxy-settings';
import { PastepileKey } from '../../../providers/paste/pastepile-key';
import { ShortenerSettings } from '../../../providers/shortener/shortener-settings';
import { TwitterSettings } from '../../../providers/twitter/twitter-settings';
import { MataroaSettings } from '../../../providers/mataroa/mataroa-settings';
import {
  CREDENTIAL_LIFETIME_OPTIONS,
  CredentialLifetime,
  CredentialLifetimeStore,
} from '../../../providers/credential-lifetime';
import { FeatureFlags } from '../../../feature-flags';
import {
  CONNECTION_CATALOG,
  CONNECTION_FLAGS,
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
  /**
   * True when {@link unavailableReason} is a rollout flag rather than a fact
   * about the build. Only this case gets a link to the flags page, because only
   * this case is something the reader can change.
   */
  flagged: boolean;
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
  private shortener = inject(ShortenerSettings);
  private twitter = inject(TwitterSettings);
  private mataroa = inject(MataroaSettings);
  // Not a catalog entry — a paste service is a list, not a one-account
  // connector, so the key is managed on the Pastes page. Governed here anyway,
  // because a stored secret obeys the retention policy wherever it was created.
  private pastepileKey = inject(PastepileKey);
  protected lifetimes = inject(CredentialLifetimeStore);
  private flags = inject(FeatureFlags);

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
      // A flag beats a build fact. Both can be true — Dropbox with no app key
      // *and* flagged off — and the flag is the one the reader can act on, so
      // it is the one the card explains.
      const flagReason = this.flags.disabledReason(CONNECTION_FLAGS[entry.id]);
      if (flagReason) {
        return { entry, connected: false, unavailableReason: flagReason, flagged: true };
      }
      return { ...this.liveRow(entry), flagged: false };
    }),
  );

  /** The catalog entry joined to its session state, ignoring rollout flags. */
  private liveRow(entry: ConnectionCatalogEntry): Omit<ConnectionCatalogRow, 'flagged'> {
    {
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
        case 'link-shortener':
          // Same standard as the proxy: a stored key with no short domain (which
          // Short.io requires) is configured but not usable, and the card should
          // not claim otherwise.
          return { entry, connected: this.shortener.usable(), unavailableReason: null };
        case 'twitter':
          // Deliberately the weakest claim on this page: a key is stored and a
          // source is chosen. Unlike the others, that is genuinely not enough to
          // work — these services need a header-forwarding CORS proxy and a
          // consent on top — but the card is a directory entry, not a health
          // check, and the connector's own page owns the five-stage setup state.
          // Reporting "not connected" to someone who has pasted a valid key
          // would send them looking for a key problem that does not exist.
          return { entry, connected: this.twitter.usable(), unavailableReason: null };
        case 'mataroa':
          return { entry, connected: this.mataroa.connected(), unavailableReason: null };
      }
    }
  }

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
      this.shortener,
      this.twitter,
      this.mataroa,
      this.pastepileKey,
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
