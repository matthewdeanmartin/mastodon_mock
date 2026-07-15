import { beforeEach, vi } from 'vitest';

// The default 5s per-test timeout flakes on loaded machines — component-heavy
// specs (full Shell, StatusCard) intermittently exceed it under worker
// contention even though the work is synchronous. Nothing here legitimately
// waits, so a generous ceiling only affects genuinely hung tests.
vi.setConfig({ testTimeout: 30_000 });

// Spec files can share a jsdom realm (vitest worker reuse), so Web Storage written
// by one file leaks into the next: e.g. shell.spec saves sessions whose `server`
// points at another instance, which makes a later file's same-origin HTTP
// expectations miss. Clear storage before every test so each starts from the
// clean-browser state the specs assume.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
