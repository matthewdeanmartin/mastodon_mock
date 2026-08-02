import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionDoctor } from './connection-doctor';
import {
  corsHint,
  homeServerTarget,
  interpret,
  ProbeTarget,
  timingHint,
} from './connection-doctor-catalog';

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
    expect(doctor.results()['ok'].verdict).toBe('reachable');
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

  it('asks separately whether the app may read the reply', async () => {
    await doctor.runAll([target('ok')]);

    // Two different questions with different remedies: "did bytes arrive" and
    // "may I look at them". Only the second is what a CORS proxy solves.
    expect(fetchMock.mock.calls[0][1].mode).toBe('no-cors');
    expect(fetchMock.mock.calls[1][1].mode).toBe('cors');
    expect(doctor.results()['ok'].cors).toBe('readable');
  });

  it('records a reachable host that refuses to be read as CORS-blocked', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.mode === 'cors'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response()),
    );
    await doctor.runAll([target('opaque')]);

    const result = doctor.results()['opaque'];
    expect(result.verdict).toBe('reachable');
    expect(result.cors).toBe('blocked');
  });

  it('reports a host that refuses as blocked, without guessing why', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await doctor.runAll([target('blocked')]);
    expect(doctor.results()['blocked'].verdict).toBe('failed');
  });

  it('does not attempt a CORS verdict for a host it never reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await doctor.runAll([target('blocked')]);

    // The misdiagnosis this whole split exists to prevent: calling an
    // unreachable host "CORS blocked" is what sends people installing
    // extensions that cannot possibly help.
    expect(doctor.results()['blocked'].cors).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times how long the probe took', async () => {
    await doctor.runAll([target('ok')]);
    // The shape of a failure is evidence in its own right, so the duration has
    // to survive as a number rather than only as a verdict.
    expect(doctor.results()['ok'].ms).toBeTypeOf('number');
    expect(doctor.results()['ok'].ms).toBeGreaterThanOrEqual(0);
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
    await vi.waitFor(() => expect(doctor.results()['slow'].verdict).toBe('timeout'));
    await run;
  });

  it('probes every target rather than stopping at the first failure', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('a.example')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response()),
    );
    await doctor.runAll([target('a'), target('b'), target('c')]);

    expect(doctor.results()['a'].verdict).toBe('failed');
    expect(doctor.results()['c'].verdict).toBe('reachable');
  });

  it('ignores a second sweep while one is in flight', async () => {
    // Every leg parks until released, so the sweep is genuinely still running
    // when the second call arrives rather than merely slow.
    const pending: (() => void)[] = [];
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => pending.push(() => resolve(new Response()))),
    );

    const first = doctor.runAll([target('a')]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await doctor.runAll([target('a')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Release the reachability leg, then the CORS leg it starts in turn.
    pending.shift()!();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()!();

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

describe('timingHint', () => {
  it('reads an instant failure as the request never leaving the browser', () => {
    // The one failure shape that points at something installed locally rather
    // than at the network, which is worth separating precisely because the
    // remedy is different.
    const hint = timingHint({ verdict: 'failed', cors: 'unknown', ms: 3 })!;
    expect(hint).toContain('too fast for anything to have gone out');
    expect(hint).toContain('3ms');
  });

  it('does not call an ordinary round-trip refusal a local block', () => {
    // Measured against real hosts: a refusal from a nearby server lands around
    // 50-350ms. Calling that "an extension blocked it" sends the reader after
    // software that is not there.
    for (const ms of [68, 83, 342]) {
      expect(timingHint({ verdict: 'failed', cors: 'unknown', ms })).toContain('one round trip');
    }
  });

  it('reads a slow failure as something along the path refusing', () => {
    expect(timingHint({ verdict: 'failed', cors: 'unknown', ms: 800 })).toContain(
      'reached something that refused it',
    );
  });

  it('reads a timeout as silent discard', () => {
    expect(timingHint({ verdict: 'timeout', cors: 'unknown', ms: 8000 })).toContain(
      'discarded silently',
    );
  });

  it('flags a host that works but is slow enough to feel broken', () => {
    // AllOrigins is exactly this case, and a green row alone would mislead.
    expect(timingHint({ verdict: 'reachable', cors: 'readable', ms: 6200 })).toContain('6.2s');
  });

  it('says nothing when the timing adds nothing', () => {
    // A hint on every row is noise, and noise is how a diagnostic stops being
    // read at all.
    expect(timingHint({ verdict: 'reachable', cors: 'readable', ms: 210 })).toBeNull();
    expect(timingHint({ verdict: 'idle', cors: 'unknown', ms: null })).toBeNull();
  });
});

describe('corsHint', () => {
  it('explains that a blocked read is the host’s decision, not a local setting', () => {
    const hint = corsHint({ verdict: 'reachable', cors: 'blocked', ms: 300 })!;
    expect(hint).toContain('their policy');
    // The load-bearing claim: nothing installed on this side changes it, which
    // is why the extension advice is wrong.
    expect(hint).toContain('not something a browser setting can grant you');
  });

  it('says a readable host needs no proxy', () => {
    expect(corsHint({ verdict: 'reachable', cors: 'readable', ms: 300 })).toContain(
      'no proxy needed',
    );
  });

  it('refuses to mention CORS for a host that was never reached', () => {
    // Naming CORS here would invite exactly the wrong fix for a network block.
    expect(corsHint({ verdict: 'failed', cors: 'unknown', ms: 50 })).toBeNull();
    expect(corsHint({ verdict: 'timeout', cors: 'unknown', ms: 8000 })).toBeNull();
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

  it('clears the network on a bot check, and says clicking through will not fix it', () => {
    // The outcome that neither "loaded" nor "blocked" covers: the host is
    // answering, so the network is exonerated, but the connector still cannot
    // work — and the user will otherwise pass the challenge, see the site, and
    // reasonably expect the app to start working.
    const reading = interpret('failed', 'bot-check');
    expect(reading).toContain('your network is fine');
    expect(reading).toContain('keep failing even after you clear the challenge');
  });

  it('treats a bot check as a non-issue when the request got through anyway', () => {
    const reading = interpret('reachable', 'bot-check');
    expect(reading).toContain('Nothing to do');
  });

  it('never claims certainty about a silent drop', () => {
    // A firewall discarding packets and a slow host are genuinely
    // indistinguishable, and the copy has to say so.
    expect(interpret('timeout', 'timed-out')).toContain('looks the same');
  });
});
