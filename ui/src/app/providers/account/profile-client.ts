import { inject, Injectable, InjectionToken } from '@angular/core';
import { MawkingbirdSession } from './mawkingbird-session';
import { MawkingbirdMetrics, billingTier } from '../../observability/mawkingbird-metrics';
import { RemoteStorageUsage } from '../../observability/remote-storage-usage';
import { profileOrigin } from './profile-origin';
import type { PortableConfig } from '../../portable-config';

/**
 * The wire client for the profile service.
 *
 * Deliberately thin and deliberately not a sync engine: this module knows how to
 * make one request and interpret one response. Deciding *whether* to write, and
 * what to do about a conflict, is `ProfileSync`'s job.
 *
 * ## Conditional requests are the whole protocol
 *
 * Every write carries `If-Match` (update) or `If-None-Match: *` (create). The
 * service refuses an unconditional write with 428, on purpose — an
 * unconditional write is the lost-update bug, and making it impossible to
 * express beats documenting that it is discouraged. So there is no method here
 * that writes without a precondition.
 *
 * ## Bearer, never cookies
 *
 * Unlike the auth services, this one is called with `credentials: 'omit'`. The
 * token goes in a header. That keeps the service out of cookie semantics
 * entirely — no `SameSite`, no third-party blocking, no CSRF surface — and it is
 * why the service refuses to send `Access-Control-Allow-Credentials`.
 */

/** Where the profile service lives. Overridable so specs need no network. */
export const PROFILE_ORIGIN = new InjectionToken<string>('PROFILE_ORIGIN', {
  providedIn: 'root',
  factory: () => profileOrigin(),
});

/** The settings document as stored. Extends the portable config's shape. */
export interface SettingsDocument {
  kind: 'mawkingbird-profile-settings';
  schemaVersion: number;
  minimumReaderVersion: number;
  revision: number;
  updatedAt: string;
  writer: string;
  values: Record<string, string>;
  /**
   * The exact set of global keys this document is authoritative for.
   *
   * Sent so the service can validate precisely rather than guessing. It cannot
   * derive this itself: telling `mockingbird_rss_feeds_a1b2c3` from a
   * legitimately underscored global key needs the registry's `base` names, and
   * the service deliberately holds no copy of the registry.
   *
   * It is also what makes a *removal* meaningful. Without it, "this key is
   * absent" and "this key was deleted" are the same bytes.
   */
  keys: string[];
}

/** What `GET /manifest` reports. */
export interface ProfileManifest {
  readOnly: boolean;
  settings?: { etag: string; revision: number; updatedAt: string; size: number };
  quota: { used: number; limit: number };
  conflicts: number;
}

/** A settings document plus the ETag needed to write over it. */
export interface FetchedSettings {
  document: SettingsDocument;
  etag: string;
}

/**
 * Every way a profile request can end.
 *
 * A discriminated union rather than exceptions, because most of these are
 * *expected* outcomes the caller must branch on — a conflict and a lapsed
 * subscription are both normal, and neither is exceptional in the sense that
 * word usually implies.
 */
export type ProfileResult<T> =
  | { kind: 'ok'; value: T }
  /** Nothing stored yet. */
  | { kind: 'absent' }
  /** Unchanged since the ETag we sent. */
  | { kind: 'unchanged' }
  /** Someone else wrote first. Carries the winning document. */
  | { kind: 'conflict'; current: SettingsDocument; etag: string }
  /** Not entitled: free tier, or a lapsed subscription. Reads still work. */
  | { kind: 'payment-required'; message: string }
  /** Signed out, anonymous, or not on the tester list. */
  | { kind: 'forbidden'; message: string }
  /** Anything else: offline, CORS, 5xx, a malformed body. */
  | { kind: 'failed'; message: string };

@Injectable({ providedIn: 'root' })
export class ProfileClient {
  private base = inject(PROFILE_ORIGIN);
  private session = inject(MawkingbirdSession);
  private metrics = inject(MawkingbirdMetrics);
  private remoteStorage = inject(RemoteStorageUsage);

  /** What the account has stored, and whether writes are allowed. */
  async manifest(): Promise<ProfileResult<ProfileManifest>> {
    const result = await this.request<ProfileManifest>('/manifest', { method: 'GET' });
    // Bank the quota on the way past. It is the service's own accounting —
    // a KV counter it keeps per user — so it is the only honest source for
    // "how much am I storing remotely", and it arrives free on a request the
    // app already makes. Captured here rather than at the call sites because
    // every caller comes through this method.
    if (result.kind === 'ok' && result.value.quota) {
      this.remoteStorage.record(result.value.quota, billingTier(this.session.heldTier()));
    }
    return result;
  }

  /**
   * Fetch the settings document.
   *
   * `knownEtag` turns this into a cheap poll: the service answers 304 when
   * nothing changed, which is what makes a focus-triggered check affordable.
   */
  async fetchSettings(knownEtag?: string): Promise<ProfileResult<FetchedSettings>> {
    const headers: Record<string, string> = {};
    if (knownEtag) {
      headers['If-None-Match'] = knownEtag;
    }
    const response = await this.send('/settings', { method: 'GET', headers });
    if (typeof response === 'string') {
      return { kind: 'failed', message: response };
    }
    if (response.status === 304) {
      return { kind: 'unchanged' };
    }
    if (response.status === 404) {
      return { kind: 'absent' };
    }
    const refusal = await this.refusalFor(response);
    if (refusal) {
      return refusal;
    }
    const etag = response.headers.get('ETag');
    if (!etag) {
      // Without an ETag there is nothing to write back against, so treating this
      // as success would produce a document that can never be updated.
      return { kind: 'failed', message: 'The profile service returned no ETag.' };
    }
    try {
      return { kind: 'ok', value: { document: (await response.json()) as SettingsDocument, etag } };
    } catch {
      return { kind: 'failed', message: 'The profile service returned an unreadable document.' };
    }
  }

  /**
   * Write the settings document.
   *
   * `etag` updates; its absence creates. There is no third option, which is the
   * point — see the class comment.
   */
  async putSettings(
    document: SettingsDocument,
    etag?: string,
  ): Promise<ProfileResult<{ etag: string; revision: number }>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (etag) {
      headers['If-Match'] = etag;
    } else {
      headers['If-None-Match'] = '*';
    }

    const response = await this.send('/settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify(document),
    });
    if (typeof response === 'string') {
      return { kind: 'failed', message: response };
    }

    // 412 carries the winning document, which is what lets a conflict resolve in
    // one round trip instead of two.
    if (response.status === 412) {
      try {
        const body = (await response.json()) as { current?: SettingsDocument };
        const currentEtag = response.headers.get('ETag') ?? '';
        if (body.current) {
          return { kind: 'conflict', current: body.current, etag: currentEtag };
        }
      } catch {
        // Fall through to the generic failure below.
      }
      return { kind: 'failed', message: 'The stored settings changed while saving.' };
    }

    // 409 means the revision did not advance — the client is behind and does not
    // know it. Reported as a conflict so the caller re-reads, which is the same
    // remedy.
    if (response.status === 409) {
      return { kind: 'failed', message: 'This browser is behind. Re-reading before saving.' };
    }

    const refusal = await this.refusalFor(response);
    if (refusal) {
      return refusal;
    }
    try {
      const body = (await response.json()) as { etag?: string; revision?: number };
      const newEtag = body.etag ?? response.headers.get('ETag');
      if (!newEtag || typeof body.revision !== 'number') {
        return { kind: 'failed', message: 'The profile service returned an unexpected answer.' };
      }
      return { kind: 'ok', value: { etag: newEtag, revision: body.revision } };
    } catch {
      return { kind: 'failed', message: 'The profile service returned an unreadable answer.' };
    }
  }

  /** Delete the stored settings document. Allowed even on a lapsed account. */
  async deleteSettings(etag: string): Promise<ProfileResult<true>> {
    const response = await this.send('/settings', {
      method: 'DELETE',
      headers: { 'If-Match': etag },
    });
    if (typeof response === 'string') {
      return { kind: 'failed', message: response };
    }
    if (response.status === 404) {
      return { kind: 'absent' };
    }
    const refusal = await this.refusalFor(response);
    if (refusal) {
      return refusal;
    }
    return { kind: 'ok', value: true };
  }

  /**
   * Everything stored, as one document.
   *
   * Works on a lapsed account, which is the point: nobody should be held hostage
   * by a service holding data they cannot get back out. The cancellation flow
   * calls this.
   */
  async exportAll(): Promise<ProfileResult<unknown>> {
    return this.request<unknown>('/export', { method: 'GET' });
  }

  /**
   * A generic JSON GET.
   *
   * Only used for endpoints with no conditional-request semantics; anything
   * involving an ETag has its own method above so the header handling cannot
   * drift.
   */
  private async request<T>(path: string, init: RequestInit): Promise<ProfileResult<T>> {
    const response = await this.send(path, init);
    if (typeof response === 'string') {
      return { kind: 'failed', message: response };
    }
    if (response.status === 404) {
      return { kind: 'absent' };
    }
    const refusal = await this.refusalFor(response);
    if (refusal) {
      return refusal;
    }
    try {
      return { kind: 'ok', value: (await response.json()) as T };
    } catch {
      return { kind: 'failed', message: 'The profile service returned an unreadable answer.' };
    }
  }

  /**
   * Turn a non-OK response into the matching refusal, or null if it was fine.
   *
   * 402 is kept distinct from 403 because they mean opposite things to the UI:
   * one says "your subscription lapsed, your data is safe and readable", the
   * other says "you are not signed in". Collapsing them would produce a message
   * that is wrong half the time.
   */
  private async refusalFor(response: Response): Promise<ProfileResult<never> | null> {
    if (response.ok) {
      return null;
    }
    const message = await this.messageFrom(response);
    if (response.status === 402) {
      return {
        kind: 'payment-required',
        message: message ?? 'Profile storage is part of Mawkingbird Plus.',
      };
    }
    if (response.status === 401 || response.status === 403) {
      return { kind: 'forbidden', message: message ?? 'Sign in to use your Mawkingbird profile.' };
    }
    return {
      kind: 'failed',
      message: message ?? `The profile service answered ${response.status}.`,
    };
  }

  /**
   * The service's own error sentence, when it sent one.
   *
   * Safe to show verbatim: every error string these Workers emit is written for
   * a person to read, and they deliberately never relay an upstream provider's
   * message.
   */
  private async messageFrom(response: Response): Promise<string | null> {
    try {
      const body = (await response.json()) as { error?: unknown };
      return typeof body.error === 'string' && body.error ? body.error : null;
    } catch {
      return null;
    }
  }

  /**
   * One authenticated request.
   *
   * Returns the `Response`, or a string when the request never completed —
   * offline, DNS, or a CORS refusal, which are indistinguishable from here and
   * all mean "no answer" rather than "an answer I did not like".
   */
  private async send(path: string, init: RequestInit): Promise<Response | string> {
    const token = await this.session.token();
    if (!token) {
      return 'Could not reach the Mawkingbird account service.';
    }
    // The tier of the token actually being sent, captured before the request
    // rather than after it: this is what the service will bill against, and a
    // subscription that starts or lapses mid-flight must not relabel a call
    // that was already paid for at the old rate.
    const tier = billingTier(this.session.heldTier());
    const start = performance.now();
    try {
      const response = await fetch(`${this.base}${path}`, {
        ...init,
        // No cookies, ever. See the class comment.
        credentials: 'omit',
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
      // A 402 or 409 is a real answer from a service that did the work of
      // deciding, so it counts as a call. Only a request that never completed
      // is an error here, which is the `catch` below.
      this.metrics.record('profile', tier, performance.now() - start, response.ok);
      return response;
    } catch (error: unknown) {
      this.metrics.record('profile', tier, performance.now() - start, false);
      return error instanceof Error && error.message
        ? `Could not reach the profile service. (${error.message})`
        : 'Could not reach the profile service.';
    }
  }
}

/** Re-exported so a caller building a document needs one import. */
export type { PortableConfig };
