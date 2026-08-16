import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { map, Observable, switchMap, tap } from 'rxjs';
import { externalFetch } from '../external-fetch';
import { scopedKey } from '../../account-scope';
import {
  ACCOUNT_MODE_KEY,
  BSKY_IDENTITY_CREDENTIALS_KEY,
  BSKY_IDENTITY_PROFILE_KEY,
  blueskyIsPrimaryKind,
} from './bluesky-identity-store';
import {
  credentialExpired,
  credentialExpiresAt,
  ensureStamped,
  ExpiringCredential,
  ExpiringConnection,
} from '../credential-lifetime';

/**
 * The link is stored in two halves so a settings export can carry one and never
 * the other: the profile (who is linked) is `private`, the JWTs are `secret`.
 * In memory they stay a single {@link BskySession} — the split is purely a
 * storage concern. See `storage-registry.ts`.
 */
const PROFILE_KEY_BASE = 'mockingbird_bsky_profile';
const CREDENTIALS_KEY_BASE = 'mockingbird_bsky_credentials';

/** The default PDS; personal PDSes could be supported later via the login form. */
export const BSKY_SERVICE = 'https://bsky.social';

export interface BskySession extends ExpiringCredential {
  service: string;
  handle: string;
  did: string;
  accessJwt: string;
  refreshJwt: string;
  displayName?: string;
  avatar?: string;
  /** The account's real PDS host (resolved lazily); chat calls must hit it, not the entryway. */
  pdsUrl?: string;
}

interface SessionResponse {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

interface ProfileResponse {
  displayName?: string;
  avatar?: string;
}

/** The secret half: the tokens, plus the retention stamp that governs them. */
interface BskyCredentials extends ExpiringCredential {
  accessJwt: string;
  refreshJwt: string;
}

/** The exportable half: who is linked. */
type BskyProfile = Omit<BskySession, 'accessJwt' | 'refreshJwt' | 'connectedAt'>;

/**
 * Rejoin the two halves. A profile with no credentials is not a usable link, so
 * the orphan is cleared — which is what a machine that imported settings but has
 * not re-authorized Bluesky yet will see.
 *
 * `governedByLifetime` is false for the primary identity. Retention is enforced
 * in two places — here, on load, and in `enforceLifetime()` — and exempting only
 * the latter would still delete a Bluesky-primary account's credentials on the
 * first boot after the window closed, before anything could intervene. The
 * reasoning for the exemption is on {@link BlueskySession.enforceLifetime}.
 */
function loadSession(
  profileKey: string,
  credentialsKey: string,
  governedByLifetime: boolean,
): BskySession | null {
  try {
    const profileRaw = localStorage.getItem(profileKey);
    const credentialsRaw = localStorage.getItem(credentialsKey);
    if (!profileRaw || !credentialsRaw) {
      localStorage.removeItem(profileKey);
      localStorage.removeItem(credentialsKey);
      return null;
    }
    const profile = JSON.parse(profileRaw) as BskyProfile;
    const credentials = ensureStamped(
      credentialsKey,
      JSON.parse(credentialsRaw) as BskyCredentials,
    );
    if (governedByLifetime && credentialExpired(credentials.connectedAt)) {
      localStorage.removeItem(profileKey);
      localStorage.removeItem(credentialsKey);
      return null;
    }
    return { ...profile, ...credentials };
  } catch {
    return null;
  }
}

/**
 * The linked Bluesky account. Login is `com.atproto.server.createSession` with an
 * app password (revocable, made at bsky.app Settings → App Passwords) — never the
 * real account password. Access tokens are short-lived; `refresh()` swaps the
 * refresh token for a new pair and is invoked by BlueskyApi on ExpiredToken.
 *
 * ## Two roles, one class
 *
 * Under a Mastodon-primary or Anonymous account, a Bluesky link is a
 * **connector**: one of several networks hanging off someone else's identity,
 * stored per-account at `scopedKey(...)` so a link made as one persona is not
 * visible as another.
 *
 * Under a Bluesky-primary account it **is** the identity, and lives in the
 * unscoped identity keys (see `bluesky-identity-store.ts`) — scoping it by the
 * active account would be circular, since the suffix derives from the DID inside
 * the thing being scoped.
 *
 * Which pair of keys this instance uses is decided here, at construction, and
 * nowhere else. That is deliberate: every consumer in the app
 * (`BlueskyApi`, `BlueskyChatApi`, `BlueskyProvider`, `BlueskyReply`) injects
 * this singleton and reads `session()`, so resolving the role in one place means
 * a Bluesky-primary account lights all of them up with no changes of their own.
 */
@Injectable({ providedIn: 'root' })
export class BlueskySession implements ExpiringConnection {
  private http = inject(HttpClient);

  /**
   * Whether this instance is the app's identity rather than a connector.
   *
   * Read from storage rather than from `Auth` on purpose: `Auth` injects nothing
   * from `providers/`, and taking a dependency the other way would close a cycle
   * (`account-scope` → identity store → ... ). The mode key and the identity
   * store are the same two facts `Auth.storedKind()` consults, so the two cannot
   * disagree.
   */
  private readonly isIdentity = blueskyIsPrimaryKind();

  /**
   * Resolved once at construction. Account switches hard-reload the app, which
   * reconstructs this against the new account's keys — including switching
   * between the identity pair and a connector pair.
   */
  private readonly profileKey = this.isIdentity
    ? BSKY_IDENTITY_PROFILE_KEY
    : scopedKey(PROFILE_KEY_BASE);
  private readonly credentialsKey = this.isIdentity
    ? BSKY_IDENTITY_CREDENTIALS_KEY
    : scopedKey(CREDENTIALS_KEY_BASE);
  readonly session = signal<BskySession | null>(
    loadSession(this.profileKey, this.credentialsKey, !this.isIdentity),
  );
  readonly linked = computed(() => this.session() !== null);

  /** True when this Bluesky account is the identity the app is signed in as. */
  get isPrimaryIdentity(): boolean {
    return this.isIdentity;
  }

  /**
   * When this link ages out under the retention policy, or null.
   *
   * Always null for the primary identity — see {@link enforceLifetime}.
   */
  expiresAt(): number | null {
    return this.isIdentity ? null : credentialExpiresAt(this.session()?.connectedAt);
  }

  /**
   * Drop the link if it has outlived the retention policy. The clock runs from
   * the original login, not from the last token refresh — otherwise a session
   * that keeps refreshing itself would never age out, which is exactly the
   * situation the policy exists to end.
   *
   * **The retention policy does not apply to the primary identity.** Read the
   * policy's own rationale (`credential-lifetime.ts`): it exists so that "I
   * connected GitHub once in 2024" stops being true by default — it governs
   * *connector* credentials the user has forgotten about. The account you are
   * signed in *as* is not a forgotten side-connection, and expiring it would
   * sign the user out of the whole app after 90 days by default, with no action
   * on their part.
   *
   * Worse, it would leave `ACCOUNT_MODE_KEY = 'bluesky'` with no identity behind
   * it — precisely the stale-key state Sprint 1 built two separate guards
   * against. Signing out is `Auth`'s job, through an exit the user chose.
   */
  enforceLifetime(): void {
    if (this.isIdentity) {
      return;
    }
    const session = this.session();
    if (session && credentialExpired(session.connectedAt)) {
      this.unlink();
    }
  }

  /** Authenticate and store the result as a **connector** under the active account. */
  login(identifier: string, appPassword: string): Observable<BskySession> {
    return this.authenticate(identifier, appPassword).pipe(tap((session) => this.persist(session)));
  }

  /**
   * Authenticate and store the result as the app's **primary identity**.
   *
   * Separate from {@link login} because of an ordering problem, not a protocol
   * one: this instance resolved its storage keys at construction, and at the
   * moment a first-time Bluesky login is submitted the active kind is not yet
   * `bluesky` — so `this.profileKey` is a *connector* key. Writing the identity
   * through it would file the app's identity under the previous account's
   * namespace, where the next boot would never look for it.
   *
   * So the write goes explicitly to the unscoped identity keys. The network round
   * trip is shared; only the destination differs.
   *
   * The caller is expected to follow this with `Auth.enterBluesky()`, which is
   * what makes the identity active — this method deliberately does not touch the
   * account-kind key, so a failed or abandoned login cannot leave the app
   * claiming to be signed in.
   */
  loginAsIdentity(identifier: string, appPassword: string): Observable<BskySession> {
    return this.authenticate(identifier, appPassword).pipe(
      tap((session) => {
        const { accessJwt, refreshJwt, connectedAt, ...profile } = session;
        localStorage.setItem(BSKY_IDENTITY_PROFILE_KEY, JSON.stringify(profile));
        localStorage.setItem(
          BSKY_IDENTITY_CREDENTIALS_KEY,
          JSON.stringify({ accessJwt, refreshJwt, connectedAt } satisfies BskyCredentials),
        );
        // Reflect it in memory too, so a caller that reads `session()` between the
        // write and the reload (the login page, attributing the new account) sees
        // the account it just signed in as rather than a stale connector.
        this.session.set(session);
      }),
    );
  }

  /**
   * The `createSession` round trip, plus the profile fetch that gives the account
   * a display name and avatar. Persists nothing — callers choose where it lands.
   */
  private authenticate(identifier: string, appPassword: string): Observable<BskySession> {
    return this.http
      .post<SessionResponse>(
        `${BSKY_SERVICE}/xrpc/com.atproto.server.createSession`,
        { identifier, password: appPassword },
        { context: externalFetch() },
      )
      .pipe(
        map(
          (res): BskySession => ({
            service: BSKY_SERVICE,
            handle: res.handle,
            did: res.did,
            accessJwt: res.accessJwt,
            refreshJwt: res.refreshJwt,
            // Retention starts here and is carried through every later
            // persist() (refresh, PDS discovery) untouched.
            connectedAt: Date.now(),
          }),
        ),
        // Grab display name + avatar so the UI can attribute the viewer's own replies.
        switchMap((session) =>
          this.http
            .get<ProfileResponse>(
              `${session.service}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(session.did)}`,
              {
                headers: { Authorization: `Bearer ${session.accessJwt}` },
                context: externalFetch(),
              },
            )
            .pipe(
              map((profile) => ({
                ...session,
                displayName: profile.displayName,
                avatar: profile.avatar,
              })),
            ),
        ),
      );
  }

  /** Swap the refresh token for a fresh access/refresh pair. */
  refresh(): Observable<BskySession> {
    const current = this.session();
    if (!current) {
      throw new Error('No Bluesky session to refresh.');
    }
    return this.http
      .post<SessionResponse>(`${current.service}/xrpc/com.atproto.server.refreshSession`, null, {
        headers: { Authorization: `Bearer ${current.refreshJwt}` },
        context: externalFetch(),
      })
      .pipe(
        map((res) => ({ ...current, accessJwt: res.accessJwt, refreshJwt: res.refreshJwt })),
        tap((session) => this.persist(session)),
      );
  }

  /** Remember the resolved PDS host so chat calls skip the DID lookup next time. */
  setPdsUrl(url: string): void {
    const current = this.session();
    if (current && current.pdsUrl !== url) {
      this.persist({ ...current, pdsUrl: url });
    }
  }

  /**
   * Forget the linked account (tokens dropped; revoke the app password on bsky.app).
   *
   * For the **primary identity** this also clears the account-kind key, because
   * the alternative is worse: a `bluesky` kind with no identity behind it is the
   * stale-key state, and the app would boot claiming to be signed in as an
   * account whose credentials no longer exist. Dropping the kind leaves the
   * browser signed out, which is what removing your only identity means.
   *
   * Callers that want a graceful sign-out should go through `Auth` (which offers
   * the leave dialog and its export) rather than here; this is the blunt path,
   * reached from Settings → Connections → Unlink.
   */
  unlink(): void {
    localStorage.removeItem(this.profileKey);
    localStorage.removeItem(this.credentialsKey);
    if (this.isIdentity) {
      localStorage.removeItem(ACCOUNT_MODE_KEY);
    }
    this.session.set(null);
  }

  /** Write the profile and the tokens to their separate keys. */
  private persist(session: BskySession): void {
    const { accessJwt, refreshJwt, connectedAt, ...profile } = session;
    localStorage.setItem(this.profileKey, JSON.stringify(profile));
    localStorage.setItem(
      this.credentialsKey,
      JSON.stringify({ accessJwt, refreshJwt, connectedAt } satisfies BskyCredentials),
    );
    this.session.set(session);
  }
}
