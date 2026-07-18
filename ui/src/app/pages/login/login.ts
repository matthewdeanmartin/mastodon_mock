import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { MockApi } from '../../mock-api';
import { Auth } from '../../auth';
import { DevUser } from '../../models';
import { Server, SERVER_PRESETS } from '../../server';
import { environment } from '../../../environments/environment';
import { AppFooter } from '../../shell/app-footer/app-footer';

const OAUTH_APP_KEY = 'mastodon_mock_oauth_app';

interface StoredApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Tab = 'signin' | 'mock' | 'init';

/** Well-known instances offered in the server combo's suggestion list. */
const COMMON_SERVERS = [
  'mastodon.social',
  'mastodon.online',
  'fosstodon.org',
  'hachyderm.io',
  'mstdn.social',
  'mas.to',
  'techhub.social',
  'mastodon.art',
];

/** Something that could plausibly be an instance host (with or without scheme). */
const DOMAIN_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}$/i;

/** How the current server-combo text relates to a reachable instance. */
type ServerStatus = 'idle' | 'checking' | 'ok' | 'unreachable';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, AppFooter],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit, OnDestroy {
  private api = inject(Api);
  private mockApi = inject(MockApi);
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected server = inject(Server);

  protected tab = signal<Tab>('signin');

  /** Build flavor: brand text and whether mock-only login tabs are shown. */
  protected brand = environment.brand;
  protected mockTooling = environment.mockTooling;

  protected serverPresets = SERVER_PRESETS;
  protected readonly commonServers = COMMON_SERVERS;
  protected customServer = signal('');
  /** Reachability of what's typed in the server combo (drives the ✓/⚠ hint). */
  protected serverStatus = signal<ServerStatus>('idle');
  /** The reached instance's self-reported title ("Mastodon", …). */
  protected serverTitle = signal<string | null>(null);
  private serverDebounce: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a slow instance probe overwriting a newer one. */
  private probeSeq = 0;

  /**
   * Mocking Bird has no "this server"; until the user picks an instance, every API call
   * would hit the static host. Gate the sign-in forms on a chosen instance.
   */
  protected needsInstance = computed(() => !this.server.allowsThisServer && !this.server.baseUrl());

  /** Short host name for buttons/copy: "mastodon.social" instead of the full URL. */
  protected serverHostLabel = computed(() => {
    const base = this.server.baseUrl();
    return base ? base.replace(/^https?:\/\//, '') : 'this server';
  });

  /**
   * The selected instance's own signup page. Only offered for remote instances —
   * the embedded mock has its own inline register form instead.
   */
  protected signupUrl = computed<string | null>(() => {
    const base = this.server.baseUrl();
    return base ? `${base}/auth/sign_up` : null;
  });

  // --- Sign in (token) ---
  protected token = signal('');
  protected error = signal<string | null>(null);
  protected checking = signal(false);

  // --- Register (mock server only: never proxy a real server's credentials) ---
  protected regUsername = signal('');
  protected regEmail = signal('');
  protected regPassword = signal('');
  protected regAgree = signal(false);
  protected regWorking = signal(false);
  protected regError = signal<string | null>(null);
  /** When set, registration succeeded; the user must click the verify link to proceed. */
  protected pendingToken = signal<string | null>(null);
  protected verifying = signal(false);

  // --- Mock login (account stable) ---
  protected devUsers = signal<DevUser[]>([]);
  protected working = signal(false);

  // --- Mock initialization (seed) ---
  protected preset = signal('small');
  protected seeding = signal(false);
  protected seedMessage = signal<string | null>(null);

  // --- Full OAuth flow (primary sign-in) ---
  protected appName = signal('mastodon_mock UI');
  protected oauthWorking = signal(false);
  protected oauthError = signal<string | null>(null);

  ngOnInit(): void {
    // Onboarding default: Mocking Bird has no "this server", so rather than greeting
    // a new user with an empty picker, preselect the biggest general-purpose instance.
    if (!this.server.allowsThisServer && !this.server.baseUrl()) {
      this.server.setBaseUrl('https://mastodon.social');
    }
    this.customServer.set(this.server.isMock ? '' : this.server.baseUrl());
    // The dev-user stable is mock-server-only. In Mocking Bird the MockApi is a stub that
    // throws, so only poll it when the mock tooling is actually present.
    if (this.mockTooling && this.server.isMock) {
      this.refreshDevUsers();
    }
    this.handleOAuthCallback();
  }

  selectTab(tab: Tab): void {
    this.tab.set(tab);
  }

  ngOnDestroy(): void {
    if (this.serverDebounce) {
      clearTimeout(this.serverDebounce);
    }
  }

  selectServer(baseUrl: string): void {
    this.server.setBaseUrl(baseUrl);
    this.customServer.set(baseUrl);
    this.serverStatus.set('idle');
    this.serverTitle.set(null);
    // Dev users only exist on the local mock; skip the call (and its throwing stub) when
    // we've switched to a real instance or this is the Mocking Bird build.
    if (this.mockTooling && this.server.isMock) {
      this.refreshDevUsers();
    }
  }

  /**
   * The server combo has no "Use" button: as soon as the text looks like a
   * domain (typed, picked from the suggestion list, or Enter), we probe its
   * /api/v1/instance and switch to it on success.
   */
  onServerInput(value: string): void {
    this.customServer.set(value);
    this.serverStatus.set('idle');
    this.serverTitle.set(null);
    if (this.serverDebounce) {
      clearTimeout(this.serverDebounce);
    }
    if (!DOMAIN_RE.test(value.trim())) {
      return;
    }
    this.serverDebounce = setTimeout(() => this.probeAndApply(value), 500);
  }

  /** Enter in the combo: don't wait for the debounce. */
  applyServerNow(): void {
    if (this.serverDebounce) {
      clearTimeout(this.serverDebounce);
    }
    void this.probeAndApply(this.customServer());
  }

  private async probeAndApply(value: string): Promise<void> {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!DOMAIN_RE.test(trimmed)) {
      return;
    }
    const base = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const seq = ++this.probeSeq;
    this.serverStatus.set('checking');
    try {
      const res = await fetch(`${base}/api/v1/instance`, { signal: AbortSignal.timeout(6000) });
      if (seq !== this.probeSeq) {
        return; // a newer probe superseded this one
      }
      if (!res.ok) {
        this.serverStatus.set('unreachable');
        return;
      }
      const info = (await res.json()) as { title?: string };
      if (seq !== this.probeSeq) {
        return;
      }
      this.server.setBaseUrl(base);
      this.serverStatus.set('ok');
      this.serverTitle.set(info.title ?? null);
    } catch {
      if (seq === this.probeSeq) {
        this.serverStatus.set('unreachable');
      }
    }
  }

  // ---------- Sign in with a pasted token ----------

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
        this.auth.removeSession(value);
        this.checking.set(false);
        this.error.set('That token was rejected. Check it and try again.');
      },
    });
  }

  // ---------- Register (mock-server-only signup) ----------

  /** Register an app for a client_credentials token, then create the account. */
  register(): void {
    if (!this.regUsername().trim() || !this.regEmail().trim() || !this.regPassword()) {
      this.regError.set('Username, email and password are required.');
      return;
    }
    if (!this.regAgree()) {
      this.regError.set('You must accept the server rules to sign up.');
      return;
    }
    this.regError.set(null);
    this.regWorking.set(true);
    const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
    this.api.registerApp('mastodon_mock signup', redirectUri).subscribe({
      next: (app) => {
        this.api.clientCredentialsToken(app.client_id, app.client_secret).subscribe({
          next: (appTok) => {
            this.api
              .register(appTok.access_token, {
                username: this.regUsername().trim(),
                email: this.regEmail().trim(),
                password: this.regPassword(),
                agreement: true,
              })
              .subscribe({
                next: (userTok) => {
                  this.regWorking.set(false);
                  // Don't sign in yet — wait for the (fake) email verification click.
                  this.pendingToken.set(userTok.access_token);
                },
                error: (err) => {
                  this.regWorking.set(false);
                  this.regError.set(this.describeRegError(err));
                },
              });
          },
          error: () => {
            this.regWorking.set(false);
            this.regError.set('Could not obtain an app token.');
          },
        });
      },
      error: () => {
        this.regWorking.set(false);
        this.regError.set('Could not register the signup app.');
      },
    });
  }

  /** Exercise the confirmation endpoint, then sign the new account in. */
  confirmAndEnter(): void {
    const tok = this.pendingToken();
    if (!tok) {
      return;
    }
    this.verifying.set(true);
    this.api.confirmEmail().subscribe({
      next: () => this.enterWith(tok),
      // The mock no-ops; even a failure shouldn't trap the new user.
      error: () => this.enterWith(tok),
    });
  }

  private enterWith(tok: string): void {
    this.verifying.set(false);
    this.pendingToken.set(null);
    this.auth.setToken(tok);
    this.api.verifyCredentials().subscribe({
      next: (acc) => {
        this.auth.setAccount(acc);
        this.router.navigateByUrl('/home');
      },
      error: () => this.router.navigateByUrl('/home'),
    });
  }

  private describeRegError(err: unknown): string {
    const detail = (err as { error?: { detail?: unknown } })?.error?.detail;
    if (typeof detail === 'string') {
      return detail;
    }
    return 'Sign-up failed — that username may be taken.';
  }

  // ---------- Mock login: dev users + account switching ----------

  generate(admin: boolean): void {
    this.working.set(true);
    this.mockApi.createDevUser(admin).subscribe({
      next: (user) => {
        this.working.set(false);
        this.enterAsDevUser(user);
        this.refreshDevUsers();
      },
      error: () => this.working.set(false),
    });
  }

  /** One-click login as an existing dev user: mint a token and add it to the stable. */
  loginAs(user: DevUser): void {
    this.working.set(true);
    this.error.set(null);
    this.mockApi.mockLogin(user.username).subscribe({
      next: (tok) => {
        this.working.set(false);
        this.enterWith(tok.access_token);
      },
      error: () => {
        this.working.set(false);
        this.error.set(`Could not log in as @${user.username}.`);
      },
    });
  }

  /** A freshly-generated dev user already carries a token; use it directly. */
  private enterAsDevUser(user: DevUser): void {
    this.enterWith(user.access_token);
  }

  refreshDevUsers(): void {
    this.mockApi.listDevUsers().subscribe({
      next: (users) => this.devUsers.set(users),
      error: () => this.devUsers.set([]),
    });
  }

  // ---------- Mock initialization: seed ----------

  seedSample(): void {
    this.seeding.set(true);
    this.seedMessage.set(null);
    this.mockApi.seedSampleData(this.preset()).subscribe({
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

  // ---------- Full OAuth flow ----------

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
          this.token.set(tok.access_token);
          this.submit();
        },
        error: () => {
          this.oauthWorking.set(false);
          this.oauthError.set('Code exchange failed.');
        },
      });
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
}
