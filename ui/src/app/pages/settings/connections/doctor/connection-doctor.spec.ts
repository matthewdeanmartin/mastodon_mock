import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionDoctor } from './connection-doctor';
import { homeServerTarget, interpret, ProbeTarget } from './connection-doctor-catalog';

function target(id: string, probeUrl = `https://${id}.example/`): ProbeTarget {
  return {
    id,
    host: `${id}.example`,
    label: id,
    category: 'connector',
    probeUrl,
    openUrl: `https://${id}.example`,
    matters: 'nothing',
  };
}

describe('ConnectionDoctor (probes)', () => {
  let doctor: ConnectionDoctor;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    doctor = TestBed.inject(ConnectionDoctor);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a host that answers as reachable', async () => {
    await doctor.runAll([target('ok')]);
    expect(doctor.verdicts()['ok']).toBe('reachable');
    expect(doctor.lastRunAt()).not.toBeNull();
  });

  it('sends no credentials and reads no response', async () => {
    await doctor.runAll([target('ok')]);

    // The whole page's promise is that it works before you have any keys and
    // touches none of the ones you do — so cookies must not ride along, and
    // no-cors is what makes an opaque success meaningful at all.
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('omit');
    expect(init.mode).toBe('no-cors');
    // A cached success would report "reachable" on a network that is down.
    expect(init.cache).toBe('no-store');
  });

  it('reports a host that refuses as blocked, without guessing why', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await doctor.runAll([target('blocked')]);
    expect(doctor.verdicts()['blocked']).toBe('failed');
  });

  it('distinguishes our own timeout from an outright failure', async () => {
    // A drop and a refusal are different diagnoses, and this is the one
    // distinction a browser can honestly make: the abort came from our timer.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
        }),
    );
    const run = doctor.runAll([target('slow')], 5);
    await vi.waitFor(() => expect(doctor.verdicts()['slow']).toBe('timeout'));
    await run;
  });

  it('probes every target rather than stopping at the first failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await doctor.runAll([target('a'), target('b'), target('c')]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(doctor.verdicts()['a']).toBe('failed');
    expect(doctor.verdicts()['c']).toBe('reachable');
  });

  it('ignores a second sweep while one is in flight', async () => {
    let release!: () => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (release = () => resolve(new Response()))),
    );

    const first = doctor.runAll([target('a')]);
    await doctor.runAll([target('a')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(doctor.running()).toBe(false);
  });
});

describe('homeServerTarget', () => {
  it('probes the instance endpoint of whatever server you are on', () => {
    const home = homeServerTarget('https://mastodon.social');
    expect(home?.host).toBe('mastodon.social');
    expect(home?.probeUrl).toBe('https://mastodon.social/api/v1/instance');
    // Opening a raw API URL in a tab shows JSON, which teaches nobody
    // anything; the human-facing page is unmistakably either itself or a
    // block page.
    expect(home?.openUrl).toBe('https://mastodon.social/about');
  });

  it('contributes no row for the built-in mock', () => {
    // An empty base URL means same-origin, and probing your own origin from
    // your own origin proves nothing about the network.
    expect(homeServerTarget('')).toBeNull();
  });
});

describe('interpret', () => {
  it('clears the network when the page loads but the request does not', () => {
    // The pairing that carries information neither half has alone, and the
    // reason the self-report step exists at all.
    const reading = interpret('failed', 'loaded');
    expect(reading).toContain('CORS');
    expect(reading).toContain('reachable');
  });

  it('names the network when the user saw a block page', () => {
    expect(interpret('failed', 'block-page')).toContain('filtering this host on purpose');
  });

  it('never claims certainty about a silent drop', () => {
    // A firewall discarding packets and a slow host are genuinely
    // indistinguishable, and the copy has to say so.
    expect(interpret('timeout', 'timed-out')).toContain('looks the same');
  });
});
