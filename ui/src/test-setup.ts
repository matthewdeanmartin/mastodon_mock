import { beforeEach } from 'vitest';

// Spec files can share a jsdom realm (vitest worker reuse), so Web Storage written
// by one file leaks into the next: e.g. shell.spec saves sessions whose `server`
// points at another instance, which makes a later file's same-origin HTTP
// expectations miss. Clear storage before every test so each starts from the
// clean-browser state the specs assume.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
