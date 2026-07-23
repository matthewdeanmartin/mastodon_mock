/**
 * "Mocking Bird" build flavor — a standalone, static-only Mastodon web client.
 *
 * Built with `ng build --configuration mockingbird` (see angular.json), which swaps this
 * file in for `environment.ts`. The output is pure static files (no Python backend); the
 * user points it at a real Mastodon instance and signs in via OAuth or a pasted token.
 *
 * All mock-server tooling is compiled out: no dev login, no sample-data seeding, no
 * fault injection. There is no "this server" default — an instance must be chosen.
 */
export const environment = {
  brand: 'Mocking Bird',
  mockTooling: false,
  allowThisServer: false,
  /** Public OAuth client id. This is safe to include in the static browser bundle. */
  dropboxAppKey: 'tx5g7f50ty6r3df',
};
