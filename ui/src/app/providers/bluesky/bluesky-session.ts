import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { map, Observable, switchMap, tap } from 'rxjs';
import { externalFetch } from '../external-fetch';

const SESSION_KEY = 'mockingbird_bsky_session';

/** The default PDS; personal PDSes could be supported later via the login form. */
export const BSKY_SERVICE = 'https://bsky.social';

export interface BskySession {
  service: string;
  handle: string;
  did: string;
  accessJwt: string;
  refreshJwt: string;
  displayName?: string;
  avatar?: string;
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

function loadSession(): BskySession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as BskySession) : null;
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
export class BlueskySession {
  private http = inject(HttpClient);

  readonly session = signal<BskySession | null>(loadSession());
  readonly linked = computed(() => this.session() !== null);

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

  /** Forget the linked account (tokens dropped; revoke the app password on bsky.app). */
  unlink(): void {
    localStorage.removeItem(SESSION_KEY);
    this.session.set(null);
  }

  private persist(session: BskySession): void {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    this.session.set(session);
  }
}
