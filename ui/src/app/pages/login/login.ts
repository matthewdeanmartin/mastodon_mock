import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { DevUser } from '../../models';
import { Server, SERVER_PRESETS } from '../../server';

const OAUTH_APP_KEY = 'mastodon_mock_oauth_app';

interface StoredApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected server = inject(Server);

  protected serverPresets = SERVER_PRESETS;
  protected customServer = signal('');

  protected token = signal('');
  protected error = signal<string | null>(null);
  protected checking = signal(false);

  protected devUsers = signal<DevUser[]>([]);
  protected working = signal(false);

  protected preset = signal('small');
  protected seeding = signal(false);
  protected seedMessage = signal<string | null>(null);

  protected showOAuth = signal(false);
  protected appName = signal('mastodon_mock UI');
  protected oauthWorking = signal(false);
  protected oauthError = signal<string | null>(null);

  ngOnInit(): void {
    this.customServer.set(this.server.isMock ? '' : this.server.baseUrl());
    this.refreshDevUsers();
    this.handleOAuthCallback();
  }

  selectServer(baseUrl: string): void {
    this.server.setBaseUrl(baseUrl);
    this.customServer.set(baseUrl);
    this.refreshDevUsers();
  }

  useCustomServer(): void {
    this.selectServer(this.customServer());
  }

  /** If we just came back from /oauth/authorize with a ?code=, exchange it for a token. */
  private handleOAuthCallback(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    if (!code) {
      return;
    }
    const raw = sessionStorage.getItem(OAUTH_APP_KEY);
    if (!raw) {
      return;
    }
    const app: StoredApp = JSON.parse(raw);
    this.showOAuth.set(true);
    this.oauthWorking.set(true);
    this.api
      .exchangeCode({
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        redirectUri: app.redirectUri,
        code,
      })
      .subscribe({
        next: (tok) => {
          this.oauthWorking.set(false);
          sessionStorage.removeItem(OAUTH_APP_KEY);
          this.router.navigate([], { queryParams: {} });
          this.use({ access_token: tok.access_token } as DevUser);
          this.submit();
        },
        error: () => {
          this.oauthWorking.set(false);
          this.oauthError.set('Code exchange failed.');
        },
      });
  }

  toggleOAuth(): void {
    this.showOAuth.update((v) => !v);
  }

  /** Register a throwaway app, then redirect through the server's account-picker. */
  startOAuth(): void {
    this.oauthError.set(null);
    this.oauthWorking.set(true);
    // Resolve against <base href> (the app may be served from a sub-path like /_ui/).
    const redirectUri = new URL('login', document.baseURI).toString();
    this.api.registerApp(this.appName(), redirectUri).subscribe({
      next: (app) => {
        const stored: StoredApp = {
          clientId: app.client_id,
          clientSecret: app.client_secret,
          redirectUri,
        };
        sessionStorage.setItem(OAUTH_APP_KEY, JSON.stringify(stored));
        const params = new URLSearchParams({
          client_id: app.client_id,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: app.scopes.join(' '),
        });
        // The instance itself handles this redirect in the user's browser, so it works
        // even when redirectUri points back at an unreachable local dev server.
        const authorizeBase = this.server.baseUrl() || window.location.origin;
        window.location.href = `${authorizeBase}/oauth/authorize?${params.toString()}`;
      },
      error: () => {
        this.oauthWorking.set(false);
        this.oauthError.set('Could not register the app.');
      },
    });
  }

  submit(): void {
    const value = this.token().trim();
    if (!value) {
      return;
    }
    this.error.set(null);
    this.checking.set(true);
    this.auth.setToken(value);
    this.api.verifyCredentials().subscribe({
      next: (acc) => {
        this.auth.setAccount(acc);
        this.checking.set(false);
        this.router.navigateByUrl('/home');
      },
      error: () => {
        this.auth.logout();
        this.checking.set(false);
        this.error.set('That token was rejected. Check it and try again.');
      },
    });
  }

  generate(admin: boolean): void {
    this.working.set(true);
    this.api.createDevUser(admin).subscribe({
      next: (user) => {
        this.working.set(false);
        this.use(user);
        this.refreshDevUsers();
      },
      error: () => this.working.set(false),
    });
  }

  /** Bulk-generate a sample cohort, then refresh the dev-user list. */
  seedSample(): void {
    this.seeding.set(true);
    this.seedMessage.set(null);
    this.api.seedSampleData(this.preset()).subscribe({
      next: ({ report }) => {
        this.seeding.set(false);
        this.seedMessage.set(
          `Created ${report.accounts.toLocaleString()} accounts, ` +
            `${report.statuses.toLocaleString()} statuses in ${report.total_seconds.toFixed(2)}s`,
        );
        this.refreshDevUsers();
      },
      error: (err) => {
        this.seeding.set(false);
        this.seedMessage.set(err?.error?.detail ?? 'Seeding failed.');
      },
    });
  }

  refreshDevUsers(): void {
    this.api.listDevUsers().subscribe({
      next: (users) => this.devUsers.set(users),
      error: () => this.devUsers.set([]),
    });
  }

  /** Autofill the token box from a dev user (does not auto-submit). */
  use(user: DevUser): void {
    this.token.set(user.access_token);
    this.error.set(null);
  }
}
