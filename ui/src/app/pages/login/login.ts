import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { MockApi } from '../../mock-api';
import { Auth } from '../../auth';
import { DevUser } from '../../models';
import { Server, SERVER_PRESETS } from '../../server';
import { MastodonServers, ServerSuggestion } from '../../mastodon-servers';
import { normalizeHostUrl } from '../../host-url';
import { environment } from '../../../environments/environment';
import { brandLogoSrc } from '../../build-flavor';
import { AppFooter } from '../../shell/app-footer/app-footer';
import { ServerDiscovery } from '../../server-discovery/server-discovery';

const OAUTH_APP_KEY = 'mastodon_mock_oauth_app';

interface StoredApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Tab = 'signin' | 'mock' | 'init';

/**
 * Something that could plausibly be an instance host (with or without scheme): a dotted
 * domain, or a local dev target (localhost / *.localhost / bare IP), each optionally :port.
 */
const DOMAIN_RE =
  /^(https?:\/\/)?(([a-z0-9-]+\.)+[a-z]{2,}|localhost|([a-z0-9-]+\.)*localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/i;

/** How the current server-combo text relates to a reachable instance. */
type ServerStatus = 'idle' | 'checking' | 'ok' | 'unreachable';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, AppFooter, ServerDiscovery],
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
  private mastodonServers = inject(MastodonServers);

  protected tab = signal<Tab>('signin');

  /** Build flavor: brand text and whether mock-only login tabs are shown. */
  protected brand = environment.brand;
  protected mockTooling = environment.mockTooling;
  /** Canary deployments (/canary/ base href) show a distinct brand mark. */
  protected logoSrc = brandLogoSrc();

  protected serverPresets = SERVER_PRESETS;
  protected customServer = signal('');
  /** Curated instances matching the combo text; drives the suggestion dropdown. */
  protected serverSuggestions = signal<ServerSuggestion[]>([]);
  /** Whether the suggestion dropdown is open (focused + has results). */
  protected suggestOpen = signal(false);
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

  /** Anonymous always targets a real instance, even in the embedded mock build. */
  protected anonymousServerHostLabel = computed(() =>
    this.server.baseUrl() ? this.serverHostLabel() : 'mastodon.social',
  );

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
  // The OAuth app name is what other clients show as each post's source, so it
  // carries the product name: the hosted flavor when served from mawkingbird.com,
  // the generic open-source name anywhere else (self-hosts, localhost).
  protected appName = signal(
    (window.location?.hostname ?? '').toLowerCase().includes('mawkingbird')
      ? 'Mawkingbird'
      : 'Mockingbird',
  );
  protected oauthWorking = signal(false);
  protected oauthError = signal<string | null>(null);

  ngOnInit(): void {
    // Already signed in? Landing on /login (bookmark, stale tab, back button) shouldn't
    // demand a fresh login cycle — verify the stored token and go straight home. An OAuth
    // callback (?code=) and the explicit add-account flow (?add=1) still show the page;
    // a dead token just leaves the user here.
    const params = this.route.snapshot.queryParamMap;
    if (!params.get('code') && !params.get('add') && this.auth.isAuthenticated) {
      if (this.auth.isAnonymous) {
        void this.router.navigateByUrl('/home');
        return;
      }
      this.api.verifyCredentials().subscribe({
        next: (acc) => {
          this.auth.setAccount(acc);
          void this.router.navigateByUrl('/home');
        },
        error: () => {
          // Token no longer works; stay on the login page.
        },
      });
    }
    // Onboarding default: Mocking Bird has no "this server", so rather than greeting
    // a new user with an empty picker, preselect the biggest general-purpose instance.
    if (!this.server.allowsThisServer && !this.server.baseUrl()) {
      this.server.setBaseUrl('https://mastodon.social');
    }
    this.customServer.set(this.server.isMock ? '' : this.server.baseUrl());
    // Warm the curated joinmastodon index (cached; weekly refresh) so the picker can
    // suggest real, described instances the moment the user focuses the field.
    this.mastodonServers.ensureLoaded();
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

  /** Enter the real application as the one browser-local Anonymous account. */
  continueAnonymously(discoveredServer?: string): void {
    const selected = discoveredServer || this.server.baseUrl() || 'https://mastodon.social';
    this.auth.enterAnonymous(selected);
    void this.router.navigateByUrl('/home');
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
    this.refreshSuggestions(value);
    if (this.serverDebounce) {
      clearTimeout(this.serverDebounce);
    }
    if (!DOMAIN_RE.test(value.trim())) {
      return;
    }
    this.serverDebounce = setTimeout(() => this.probeAndApply(value), 500);
  }

  /** Recompute the curated-instance suggestions for the current combo text. */
  private refreshSuggestions(value: string): void {
    const matches = this.mastodonServers.search(value);
    // Don't show a one-item list that just echoes an exact domain the user already typed.
    const echo = matches.length === 1 && matches[0].domain === value.trim().toLowerCase();
    this.serverSuggestions.set(echo ? [] : matches);
  }

  /** Field focused: open the dropdown with default (or current-query) suggestions. */
  onServerFocus(): void {
    this.refreshSuggestions(this.customServer());
    this.suggestOpen.set(true);
  }

  /** Blur closes the dropdown, but not before a click on an option can register. */
  onServerBlur(): void {
    setTimeout(() => this.suggestOpen.set(false), 150);
  }

  /** Pick a suggested instance: fill the field and probe it immediately. */
  chooseSuggestion(s: ServerSuggestion): void {
    this.customServer.set(s.domain);
    this.serverSuggestions.set([]);
    this.suggestOpen.set(false);
    void this.probeAndApply(s.domain);
  }

  /** A rough "big / mid / cozy" size label for a suggestion row. */
  sizeLabel(users: number): string {
    if (users >= 100_000) return 'very large';
    if (users >= 10_000) return 'large';
    if (users >= 1_000) return 'mid-size';
    if (users > 0) return 'cozy';
    return '';
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
    // Quietly supply the scheme: https for real hosts, http for localhost / IPs.
    const base = normalizeHostUrl(trimmed);
    const seq = ++this.probeSeq;
    this.suggestOpen.set(false);
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
        // If this identity is already in the stable under a different token
        // (e.g. re-running OAuth for an account you're already signed into),
        // don't pile up a duplicate session — drop the fresh token and switch to
        // the existing one. Otherwise commit the new session.
        if (!this.adoptExistingSession(acc, value)) {
          this.auth.setAccount(acc);
        }
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

  /**
   * If another saved session is the *same account on the same instance* as the
   * one we just verified, discard the newly-minted token and switch back to the
   * existing session. Returns true when an existing identity was adopted.
   */
  private adoptExistingSession(acc: { id: string }, newToken: string): boolean {
    const server = this.server.baseUrl();
    const existing = this.auth
      .sessions()
      .find((s) => s.token !== newToken && s.account?.id === acc.id && (s.server ?? '') === server);
    if (!existing) {
      return false;
    }
    // Forget the duplicate token, then re-activate the account we already had.
    this.auth.removeSession(newToken);
    this.auth.switchTo(existing.token);
    return true;
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
