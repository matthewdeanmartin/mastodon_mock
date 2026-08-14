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
  /**
   * Public OAuth client id for Blogger (Google Cloud → Credentials → OAuth
   * client ID → Web application). Safe in the bundle; the client *secret* that
   * Google issues alongside it is not, and is not used — PKCE replaces it.
   *
   * Empty hides the connector. Filling it in also requires registering
   * `https://<this build's origin>/integrations/blogger/callback` as an
   * authorized redirect URI on that OAuth client, including a separate entry
   * for the /canary/ deployment.
   */
  bloggerClientId: '',
  /**
   * Public WorkOS client id, for Mawkingbird accounts (Settings → Mawkingbird
   * Plus). Safe in the bundle: AuthKit runs as a *public client*, so PKCE
   * carries the proof and the WorkOS API key (`sk_…`) is never used in the
   * browser. Do not add that key here or anywhere else in this bundle.
   *
   * Empty hides the account page. Filling it in also requires, in the WorkOS
   * dashboard:
   *  - this build's origin in Sessions → allowed origins, and
   *  - `https://<origin>/<base href>settings/mawkingbird-plus` as a redirect
   *    URI, with a *separate* entry for the /canary/ deployment — canary and
   *    production share an origin and differ only by base href.
   */
  workosClientId: 'client_01KX8J8NQ459M3H89Y8SC7N6RK',
};
