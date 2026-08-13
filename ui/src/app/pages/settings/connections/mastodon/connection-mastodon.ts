import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Api } from '../../../../api';
import { Auth } from '../../../../auth';
import { Server } from '../../../../server';
import { normalizeHostUrl } from '../../../../host-url';
import { ServerDiscovery } from '../../../../server-discovery/server-discovery';
import {
  DEFAULT_CONNECTOR_SERVER,
  MastodonConnector,
} from '../../../../providers/mastodon/mastodon-connector';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';

/**
 * Settings → Connections → Mastodon.
 *
 * The opt-in surface for a Bluesky-primary account, and this sprint's only one.
 * The connector starts **absent** — the user reversed the earlier "silently
 * assume anonymous mastodon.social" design because a live connector spends rail
 * space, nav entries and the search default on a network the visitor never asked
 * for. So nothing here happens until someone presses a button on this page.
 *
 * Deliberately not a reuse of `pages/login/`. That page is 26KB tightly bound to
 * its own tabs, OAuth callback, registration and mock tooling; the connector
 * needs a server field and a token box, and lifting them out would drag the rest
 * along. Token paste only for now — routing the connector through the OAuth
 * callback at `<base href>login` is a follow-up, and the redirect_uri is
 * load-bearing enough that it deserves its own change.
 */
@Component({
  selector: 'app-connection-mastodon',
  imports: [FormsModule, RouterLink, ServerDiscovery],
  templateUrl: './connection-mastodon.html',
  styleUrls: ['../connection-page.css'],
})
export class ConnectionMastodon {
  protected auth = inject(Auth);
  protected connector = inject(MastodonConnector);
  private server = inject(Server);
  private api = inject(Api);

  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.account.detail;
  protected readonly defaultServer = DEFAULT_CONNECTOR_SERVER;

  protected token = signal('');
  protected signingIn = signal(false);
  protected error = signal<string | null>(null);
  protected changingServer = signal(false);

  /** The connector's state, for the template to branch on by name. */
  protected readonly state = computed(() => this.connector.current().state);

  /** Bare domain of the connected server, for display. */
  protected readonly serverLabel = computed(() =>
    (this.connector.server() ?? '').replace(/^https?:\/\//, ''),
  );

  /**
   * Whether this account can have a Mastodon connector at all.
   *
   * Only a Bluesky-primary account can: under a Mastodon-primary account
   * Mastodon *is* the identity, and Anonymous already reads a server of its own.
   * The catalog greys the card for both, but a deep link reaches this page
   * directly, so it must answer for itself too.
   */
  protected readonly applicable = computed(() => this.auth.isBlueskyPrimary);

  /**
   * Opt in with no credentials.
   *
   * Points the global `Server` at the connector's server as well: `Server` is one
   * signal behind one localStorage key that the entire Mastodon API layer reads,
   * so "the connector points at X" and "the app's Mastodon calls go to X" are
   * currently the same fact. Under a Bluesky-primary account nothing else
   * competes for it. The recorded limitation is that this forecloses two
   * simultaneous Mastodon connectors, which is not a goal.
   */
  protected enableAnonymous(): void {
    this.connector.enableAnonymous();
    this.server.setBaseUrl(DEFAULT_CONNECTOR_SERVER);
    this.error.set(null);
  }

  /** Point the connector at a different server, dropping any credentials for the old one. */
  protected chooseServer(value: string): void {
    const normalized = normalizeHostUrl(value);
    if (!normalized) {
      return;
    }
    this.connector.setServer(normalized);
    this.server.setBaseUrl(normalized);
    // The old server's token no longer authenticates anything — a token is only
    // valid against the instance that issued it.
    this.auth.disconnectMastodon();
    this.changingServer.set(false);
    this.error.set(null);
  }

  /**
   * Attach a token, upgrading the connector to signed-in.
   *
   * The token is verified before it is kept: storing an unverified credential
   * would leave the connector claiming a signed-in state that 401s on every
   * call, and Home would then merge a source that cannot answer.
   */
  protected signIn(): void {
    const token = this.token().trim();
    const server = this.connector.server();
    if (!token || !server || this.signingIn()) {
      return;
    }
    this.signingIn.set(true);
    this.error.set(null);
    // Make the token live first so the interceptor attaches it to the verify
    // call below. This is the connector seam: it sets `Auth.token()` and nothing
    // else, so `kind()` stays 'bluesky' and no row joins the account switcher.
    this.auth.connectMastodon(token);
    this.api.verifyCredentials().subscribe({
      next: (account) => {
        this.signingIn.set(false);
        this.connector.signIn(token, server, account);
        this.token.set('');
      },
      error: (err: unknown) => {
        this.signingIn.set(false);
        // Roll the token back out of `Auth` — it failed, and leaving it live
        // would make every later Mastodon call carry a credential the server
        // has already rejected.
        this.auth.disconnectMastodon();
        this.error.set(describeError(err));
      },
    });
  }

  /** Drop the credentials, keeping the opt-in. Back to anonymous, not to absent. */
  protected signOut(): void {
    this.connector.signOut();
    this.auth.disconnectMastodon();
    this.error.set(null);
  }

  /** Undo the opt-in entirely. */
  protected disable(): void {
    this.connector.disable();
    this.auth.disconnectMastodon();
    this.server.setBaseUrl('');
    this.error.set(null);
  }
}

function describeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 401 || err.status === 403) {
      return 'That server rejected the token. Check you copied all of it, and that it belongs to this server.';
    }
    if (err.status === 0) {
      return "Couldn't reach that server — network problem, or it refuses browser requests.";
    }
  }
  return 'Signing in failed — check the token and the server.';
}
