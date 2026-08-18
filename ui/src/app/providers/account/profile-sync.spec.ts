import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MawkingbirdSession } from './mawkingbird-session';
import { PROFILE_ORIGIN } from './profile-client';
import { SupporterStatus } from './supporter-status';
import { ProfileSync, SETTINGS_KIND, SETTINGS_SCHEMA_VERSION } from './profile-sync';
import { PROFILE_SYNC_KEY, writeSyncRecord } from './profile-sync-state';

/**
 * Settings sync.
 *
 * Driven through the real `ProfileClient` against a stubbed `fetch`, rather than
 * mocking the client: the conditional-request headers are half of what this
 * feature *is*, and a mocked client would let a missing `If-Match` pass.
 */

const ORIGIN = 'https://profile-test.mawkingbird.com';
const PREFS = 'mockingbird_client_prefs';

class FakeMawkingbirdSession {
  token = vi.fn().mockResolvedValue('mawkingbird-token');
}

/** The last request `fetch` was called with. */
interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[] = [];
let fetchStub: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 304 ? null : JSON.stringify(body), { status, headers });
}

function storedDocument(overrides: Record<string, unknown> = {}) {
  return {
    kind: SETTINGS_KIND,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    minimumReaderVersion: SETTINGS_SCHEMA_VERSION,
    revision: 5,
    updatedAt: '2026-08-17T09:00:00.000Z',
    writer: 'dev_other',
    values: { [PREFS]: '{"theme":"dark"}' },
    keys: [PREFS],
    ...overrides,
  };
}

/** The header value a request carried, whatever shape `headers` took. */
function headerOf(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

describe('ProfileSync', () => {
  let sync: ProfileSync;

  beforeEach(() => {
    localStorage.clear();
    calls = [];
    fetchStub = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return fetchStub(url, init);
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: MawkingbirdSession, useValue: new FakeMawkingbirdSession() },
        { provide: PROFILE_ORIGIN, useValue: ORIGIN },
      ],
    });
    sync = TestBed.inject(ProfileSync);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  describe('start', () => {
    it('detects settings stored by another browser', async () => {
      // Locally never asked, remotely present. The state that gets forgotten and
      // then becomes a support question.
      fetchStub.mockResolvedValue(
        respond(200, {
          readOnly: false,
          settings: { etag: '"a"', revision: 3, updatedAt: '…', size: 10 },
          quota: { used: 10, limit: 100 },
          conflicts: 0,
        }),
      );

      await sync.start();

      expect(sync.record().state).toBe('off-but-remote-exists');
      expect(sync.offersRemote()).toBe(true);
    });

    it('stays unasked when nothing is stored', async () => {
      fetchStub.mockResolvedValue(
        respond(200, { readOnly: false, quota: { used: 0, limit: 100 }, conflicts: 0 }),
      );
      await sync.start();
      expect(sync.record().state).toBe('unasked');
    });

    it('notices a lapsed subscription without turning sync off', async () => {
      // readOnly is reported by the manifest so the UI need not discover it one
      // failed write at a time.
      writeSyncRecord({ state: 'on', revision: 1 });
      sync.resetForTest({ state: 'on', revision: 1 });
      fetchStub.mockResolvedValue(
        respond(200, { readOnly: true, quota: { used: 0, limit: 100 }, conflicts: 0 }),
      );

      await sync.start();

      expect(sync.readOnly()).toBe(true);
      expect(sync.record().state).toBe('on');
    });

    it('does not fetch when the remote revision is not ahead', async () => {
      sync.resetForTest({ state: 'on', revision: 7, etag: '"a"' });
      fetchStub.mockResolvedValue(
        respond(200, {
          readOnly: false,
          settings: { etag: '"a"', revision: 7, updatedAt: '…', size: 10 },
          quota: { used: 10, limit: 100 },
          conflicts: 0,
        }),
      );

      await sync.start();

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain('/manifest');
    });

    it('does nothing when signed out', async () => {
      fetchStub.mockResolvedValue(respond(401, { error: 'Sign in.' }));
      await sync.start();
      expect(sync.record().state).toBe('unasked');
    });
  });

  describe('enable', () => {
    it('uploads this browser as the baseline, creating with If-None-Match', async () => {
      localStorage.setItem(PREFS, '{"theme":"light"}');
      fetchStub.mockResolvedValue(respond(200, { ok: true, etag: '"new"', revision: 1 }));

      const outcome = await sync.enable();

      expect(outcome.kind).toBe('saved');
      // The counts the UI reports come from here, so they are asserted rather
      // than assumed: a wrong number is a confidently wrong claim to the user.
      expect(outcome.kind === 'saved' && outcome.revision).toBe(1);
      expect(outcome.kind === 'saved' && outcome.keys).toBeGreaterThan(0);
      const put = calls.find((call) => call.init.method === 'PUT')!;
      // A create, not an update: nothing was stored, so there is no ETag to
      // match and an unconditional write would be refused with 428.
      expect(headerOf(put.init, 'If-None-Match')).toBe('*');
      expect(headerOf(put.init, 'If-Match')).toBeNull();
      expect(sync.record().state).toBe('on');
      expect(sync.record().dirty).toBeFalsy();
    });

    it('stays on when the first push fails, so the decision is not lost', async () => {
      fetchStub.mockResolvedValue(respond(500, { error: 'boom' }));
      const outcome = await sync.enable();

      // Names the failure rather than merely being falsy — the whole point of
      // replacing the boolean, since a discarded `false` was reported as success.
      expect(outcome.kind).toBe('failed');
      // Turning it back off would discard an explicit decision because of a
      // transient network failure.
      expect(sync.record().state).toBe('on');
      expect(sync.record().dirty).toBe(true);
    });

    it('sends a bearer token and no cookies', async () => {
      fetchStub.mockResolvedValue(respond(200, { ok: true, etag: '"new"', revision: 1 }));
      await sync.enable();

      const put = calls.find((call) => call.init.method === 'PUT')!;
      expect(headerOf(put.init, 'Authorization')).toBe('Bearer mawkingbird-token');
      expect(put.init.credentials).toBe('omit');
    });

    it('sends the exact key allowlist the service cannot derive', async () => {
      fetchStub.mockResolvedValue(respond(200, { ok: true, etag: '"new"', revision: 1 }));
      await sync.enable();

      const put = calls.find((call) => call.init.method === 'PUT')!;
      const body = JSON.parse(put.init.body as string) as { keys: string[] };
      expect(body.keys).toContain(PREFS);
      expect(body.keys.length).toBeGreaterThan(0);
    });
  });

  describe('decline and disable', () => {
    it('records a decline permanently', () => {
      sync.decline();
      expect(sync.record().state).toBe('off');
      expect(sync.offersSync(true)).toBe(false);
    });

    it('stops syncing without deleting anything', async () => {
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 4 });
      sync.disable();

      expect(sync.record().state).toBe('off');
      // No DELETE. Turning sync off says "stop changing my browser", not
      // "destroy my profile", and conflating those makes the off switch
      // frightening to use.
      expect(calls.filter((call) => call.init.method === 'DELETE')).toHaveLength(0);
    });
  });

  describe('pull', () => {
    it('applies a remote change silently when nothing local is unsaved', async () => {
      // The overwhelmingly common path. Prompting here would train people to
      // click through.
      localStorage.setItem(PREFS, '{"theme":"light"}');
      sync.resetForTest({ state: 'on', revision: 1, dirty: false });
      fetchStub.mockResolvedValue(respond(200, storedDocument(), { ETag: '"remote"' }));

      const outcome = await sync.pull();

      expect(outcome.kind).toBe('applied');
      expect(localStorage.getItem(PREFS)).toBe('{"theme":"dark"}');
      expect(sync.record().etag).toBe('"remote"');
      expect(sync.record().revision).toBe(5);
    });

    it('asks when the remote is ahead and this browser has unsaved edits', async () => {
      // The one case that must ask: either answer loses something, so it is not
      // ours to choose.
      localStorage.setItem(PREFS, '{"theme":"light"}');
      sync.resetForTest({ state: 'on', revision: 1, dirty: true });
      fetchStub.mockResolvedValue(respond(200, storedDocument(), { ETag: '"remote"' }));

      const outcome = await sync.pull();

      expect(outcome.kind).toBe('needs-decision');
      // Nothing applied yet: the user may keep this browser's copy, and a
      // partial application would already have destroyed it.
      expect(localStorage.getItem(PREFS)).toBe('{"theme":"light"}');
    });

    it('reports a diff with the decision, so the UI can show what differs', async () => {
      localStorage.setItem(PREFS, '{"theme":"light"}');
      sync.resetForTest({ state: 'on', revision: 1, dirty: true });
      fetchStub.mockResolvedValue(respond(200, storedDocument(), { ETag: '"remote"' }));

      const outcome = await sync.pull();

      expect(outcome.kind).toBe('needs-decision');
      if (outcome.kind === 'needs-decision') {
        expect(outcome.changes.some((change) => change.key === PREFS)).toBe(true);
      }
    });

    it('does nothing on 304', async () => {
      sync.resetForTest({ state: 'on', revision: 5, etag: '"a"', dirty: false });
      fetchStub.mockResolvedValue(respond(304, null));

      const outcome = await sync.pull();

      expect(outcome.kind).toBe('unchanged');
      expect(headerOf(calls[0]!.init, 'If-None-Match')).toBe('"a"');
    });

    it('reports absent when nothing is stored', async () => {
      sync.resetForTest({ state: 'on' });
      fetchStub.mockResolvedValue(respond(404, { error: 'nothing' }));
      expect((await sync.pull()).kind).toBe('absent');
    });

    it('leaves localStorage alone when the pull fails', async () => {
      // The app worked signed out before this feature existed and must still.
      localStorage.setItem(PREFS, '{"theme":"light"}');
      sync.resetForTest({ state: 'on', revision: 1 });
      fetchStub.mockResolvedValue(respond(500, { error: 'boom' }));

      const outcome = await sync.pull();

      expect(outcome.kind).toBe('failed');
      expect(localStorage.getItem(PREFS)).toBe('{"theme":"light"}');
    });
  });

  describe('resolving a decision', () => {
    it('useRemote applies the other browser and clears the dirty flag', () => {
      localStorage.setItem(PREFS, '{"theme":"light"}');
      sync.resetForTest({ state: 'on', revision: 1, dirty: true });

      sync.useRemote(
        {
          kind: 'mockingbird-client-config',
          schemaVersion: 1,
          minimumReaderVersion: 1,
          exportedAt: '2026-08-17T09:00:00.000Z',
          privacy: 'standard',
          values: { [PREFS]: '{"theme":"dark"}' },
        },
        '"remote"',
        5,
      );

      expect(localStorage.getItem(PREFS)).toBe('{"theme":"dark"}');
      expect(sync.record().dirty).toBeFalsy();
      expect(sync.record().revision).toBe(5);
    });

    it('keepLocal pushes this browser as an update, not a create', async () => {
      // Adopting the remote ETag is what makes the retry a legal update: the
      // local *content* wins, the remote *position in the sequence* is
      // respected.
      localStorage.setItem(PREFS, '{"theme":"light"}');
      sync.resetForTest({ state: 'on', revision: 1, dirty: true });
      fetchStub.mockResolvedValue(respond(200, { ok: true, etag: '"newer"', revision: 6 }));

      await sync.keepLocal('"remote"', 5);

      const put = calls.find((call) => call.init.method === 'PUT')!;
      expect(headerOf(put.init, 'If-Match')).toBe('"remote"');
      const body = JSON.parse(put.init.body as string) as { revision: number };
      // Must advance past the remote's 5, or the service answers 409.
      expect(body.revision).toBe(6);
    });
  });

  describe('push', () => {
    it('updates with If-Match once something is stored', async () => {
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 3, dirty: true });
      fetchStub.mockResolvedValue(respond(200, { ok: true, etag: '"b"', revision: 4 }));

      await sync.push();

      const put = calls.find((call) => call.init.method === 'PUT')!;
      expect(headerOf(put.init, 'If-Match')).toBe('"a"');
      expect(sync.record().dirty).toBeFalsy();
      expect(sync.record().revision).toBe(4);
    });

    it('advances the revision, since an equal one is refused with 409', async () => {
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 3, dirty: true });
      fetchStub.mockResolvedValue(respond(200, { ok: true, etag: '"b"', revision: 4 }));

      await sync.push();

      const put = calls.find((call) => call.init.method === 'PUT')!;
      const body = JSON.parse(put.init.body as string) as { revision: number };
      expect(body.revision).toBe(4);
    });

    it('adopts the winner on a 412 and keeps the dirty flag', async () => {
      sync.resetForTest({ state: 'on', etag: '"stale"', revision: 3, dirty: true });
      fetchStub.mockResolvedValue(
        respond(
          412,
          { code: 'conflict', current: storedDocument({ revision: 9 }) },
          {
            ETag: '"winner"',
          },
        ),
      );

      const outcome = await sync.push();

      expect(outcome.kind).toBe('conflict');
      expect(sync.record().etag).toBe('"winner"');
      expect(sync.record().revision).toBe(9);
      // Still unsaved: this browser's edits have not been stored anywhere.
      expect(sync.record().dirty).toBe(true);
    });

    /**
     * Regression, from a real session.
     *
     * GET /settings returned 404 (correct — nothing stored yet), the follow-up
     * push failed, and the config page said "Saved this browser's settings."
     * The cause was `push()` returning a boolean that all three call sites
     * discarded. What makes the fix real is not that the message changed but
     * that a failure is now *unrepresentable* as a success: there is no boolean
     * left to drop.
     */
    it('reports a failure as a failure, never as saved', async () => {
      sync.resetForTest({ state: 'on', dirty: true });
      fetchStub.mockResolvedValue(respond(500, { error: 'boom' }));

      const outcome = await sync.push();

      expect(outcome.kind).toBe('failed');
      expect(outcome.kind === 'failed' && outcome.message).toBeTruthy();
      // Nothing recorded as synced, so the UI cannot claim a save happened.
      expect(sync.record().lastSyncedAt).toBeUndefined();
      expect(sync.record().dirty).toBe(true);
    });

    it('an interactive push surfaces the first failure immediately', async () => {
      // Background pushes stay quiet until a failure looks persistent, which is
      // right for a blip and wrong for a button the user just clicked.
      sync.resetForTest({ state: 'on', dirty: true });
      fetchStub.mockResolvedValue(respond(500, { error: 'boom' }));

      await sync.push(true);

      expect(sync.error()).toBeTruthy();
    });

    it('a background push stays quiet on a first failure', async () => {
      sync.resetForTest({ state: 'on', dirty: true });
      fetchStub.mockResolvedValue(respond(500, { error: 'boom' }));

      await sync.push();

      expect(sync.error()).toBeNull();
    });

    it('reports what was uploaded, grouped by registry category', async () => {
      localStorage.setItem(PREFS, '{"theme":"light"}');
      fetchStub.mockResolvedValue(respond(200, { ok: true, etag: '"new"', revision: 4 }));
      sync.resetForTest({ state: 'on', dirty: true });

      const outcome = await sync.push(true);

      expect(outcome.kind).toBe('saved');
      if (outcome.kind !== 'saved') {
        return;
      }
      expect(outcome.bytes).toBeGreaterThan(0);
      // Grouped from storage-registry.ts, so the breakdown shown to the user
      // cannot drift from the classification that decides what may be exported.
      expect(Object.keys(outcome.byCategory).length).toBeGreaterThan(0);
      const grouped = Object.values(outcome.byCategory).flat();
      expect(grouped).toHaveLength(outcome.keys);
      expect(outcome.byCategory['unclassified']).toBeUndefined();
    });

    /**
     * Regression, from a real session.
     *
     * Tokens are minted twice on a cold load: the first says `tier: 'free'`
     * because the subscription lookup has not finished, the second says
     * `tier: 'plus'`. `start()` ran in that window, the manifest came back
     * `readOnly: true`, and the flag was latched — so a paying account was told
     * "your subscription has lapsed" and every push was skipped for the rest of
     * the session.
     *
     * The fix is that `readOnly` is *derived* rather than stored, so it cannot
     * outlive the fact it was about.
     */
    it('stops being read-only once the corrected tier arrives', async () => {
      const supporter = TestBed.inject(SupporterStatus);
      supporter.isSupporter.set(false);
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 1 });
      fetchStub.mockResolvedValue(
        respond(200, { readOnly: true, quota: { used: 0, limit: 100 }, conflicts: 0 }),
      );

      await sync.start();
      expect(sync.readOnly()).toBe(true);

      // The second mint lands, reporting the real tier.
      supporter.isSupporter.set(true);

      expect(sync.readOnly()).toBe(false);
    });

    it('stays read-only when the account genuinely is not entitled', async () => {
      // The other direction, so the fix cannot become "never read-only": a
      // refusal with no supporter flag behind it is a real lapse.
      TestBed.inject(SupporterStatus).isSupporter.set(false);
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 1 });
      fetchStub.mockResolvedValue(
        respond(200, { readOnly: true, quota: { used: 0, limit: 100 }, conflicts: 0 }),
      );

      await sync.start();

      expect(sync.readOnly()).toBe(true);
      expect((await sync.push()).kind).toBe('read-only');
    });

    it('re-reads the manifest when entitlement improves after startup', async () => {
      // Clearing the flag is not enough on its own: the manifest itself was
      // read under the wrong identity, so the offers and revisions taken from
      // it are stale too.
      const supporter = TestBed.inject(SupporterStatus);
      supporter.isSupporter.set(false);
      sync.resetForTest({ state: 'unasked' });
      fetchStub.mockResolvedValue(
        respond(200, { readOnly: true, quota: { used: 0, limit: 100 }, conflicts: 0 }),
      );

      await sync.start();
      const before = calls.length;

      supporter.isSupporter.set(true);
      await sync.recheckEntitlement();

      expect(calls.length).toBeGreaterThan(before);
    });

    it('does not refetch when entitlement was already correct', async () => {
      const supporter = TestBed.inject(SupporterStatus);
      supporter.isSupporter.set(true);
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 1 });
      fetchStub.mockResolvedValue(
        respond(200, { readOnly: false, quota: { used: 0, limit: 100 }, conflicts: 0 }),
      );

      await sync.start();
      const before = calls.length;
      await sync.recheckEntitlement();

      // A boolean comparison, not a request: repeated mints of an
      // already-correct token must stay free.
      expect(calls).toHaveLength(before);
    });

    it('does not push when sync is off', async () => {
      sync.resetForTest({ state: 'off' });
      expect((await sync.push()).kind).toBe('not-syncing');
      expect(calls).toHaveLength(0);
    });

    it('does not push on a lapsed subscription', async () => {
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 1 });
      fetchStub.mockResolvedValue(
        respond(200, { readOnly: true, quota: { used: 0, limit: 100 }, conflicts: 0 }),
      );
      await sync.start();
      calls = [];

      expect((await sync.push()).kind).toBe('read-only');
      expect(calls).toHaveLength(0);
    });

    it('surfaces a 402 rather than retrying forever', async () => {
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 1, dirty: true });
      fetchStub.mockResolvedValue(
        respond(402, { error: 'Profile storage is part of Mawkingbird Plus.' }),
      );

      await sync.push();

      expect(sync.readOnly()).toBe(true);
      expect(sync.error()).toContain('Mawkingbird Plus');
    });

    it('stays quiet on the first failures, then reports a persistent one', async () => {
      // One failed push is usually a tunnel or a sleeping laptop. Five is how
      // someone discovers on a new laptop that nothing has synced since March.
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 1, dirty: true });
      fetchStub.mockResolvedValue(respond(500, { error: 'boom' }));

      await sync.push();
      expect(sync.error()).toBeNull();

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await sync.push();
      }
      expect(sync.error()).not.toBeNull();
      expect(sync.record().dirty).toBe(true);
    });
  });

  describe('noteLocalChange', () => {
    it('marks the browser dirty while syncing', () => {
      sync.resetForTest({ state: 'on', etag: '"a"', revision: 1 });
      sync.noteLocalChange();
      expect(sync.record().dirty).toBe(true);
      sync.cancelPush();
    });

    it('does nothing when sync is off', () => {
      sync.resetForTest({ state: 'off' });
      sync.noteLocalChange();
      expect(sync.record().dirty).toBeFalsy();
    });
  });

  it('never stores its own sync state in an uploaded document', async () => {
    // A document describing its own sync position would be describing the wrong
    // browser the moment it arrived somewhere else.
    localStorage.setItem(PREFS, '{"theme":"light"}');
    sync.resetForTest({ state: 'on', etag: '"a"', revision: 1, dirty: true });
    fetchStub.mockResolvedValue(respond(200, { ok: true, etag: '"b"', revision: 2 }));

    await sync.push();

    const put = calls.find((call) => call.init.method === 'PUT')!;
    const body = JSON.parse(put.init.body as string) as { values: Record<string, string> };
    expect(body.values[PROFILE_SYNC_KEY]).toBeUndefined();
    expect(Object.keys(body.values)).not.toContain('mockingbird_profile_writer');
  });
});
