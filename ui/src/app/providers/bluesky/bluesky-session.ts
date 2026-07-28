import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { map, Observable, switchMap, tap } from 'rxjs';
import { externalFetch } from '../external-fetch';
import { scopedKey } from '../../account-scope';
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
 */
function loadSession(profileKey: string, credentialsKey: string): BskySession | null {
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
    if (credentialExpired(credentials.connectedAt)) {
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
 */
@Injectable({ providedIn: 'root' })
export class BlueskySession implements ExpiringConnection {
  private http = inject(HttpClient);

  /**
   * Scoped to the active account so a Bluesky link set up under one account
   * isn't visible under another. Resolved once at construction; account switches
   * hard-reload the app, reconstructing this against the new account's key.
   */
  private readonly profileKey = scopedKey(PROFILE_KEY_BASE);
  private readonly credentialsKey = scopedKey(CREDENTIALS_KEY_BASE);
  readonly session = signal<BskySession | null>(loadSession(this.profileKey, this.credentialsKey));
  readonly linked = computed(() => this.session() !== null);

  /** When this link ages out under the retention policy, or null. */
  expiresAt(): number | null {
    return credentialExpiresAt(this.session()?.connectedAt);
  }

  /**
   * Drop the link if it has outlived the retention policy. The clock runs from
   * the original login, not from the last token refresh — otherwise a session
   * that keeps refreshing itself would never age out, which is exactly the
   * situation the policy exists to end.
   */
  enforceLifetime(): void {
    const session = this.session();
    if (session && credentialExpired(session.connectedAt)) {
      this.unlink();
    }
  }

  login(identifier: string, appPassword: string): Observable<BskySession> {
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
        tap((session) => this.persist(session)),
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

  /** Forget the linked account (tokens dropped; revoke the app password on bsky.app). */
  unlink(): void {
    localStorage.removeItem(this.profileKey);
    localStorage.removeItem(this.credentialsKey);
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
