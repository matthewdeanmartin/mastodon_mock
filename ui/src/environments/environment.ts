/**
 * Default (mock-embedded) build flavor.
 *
 * This is the build served by mastodon_mock at `/_ui/`. It is the full admin/test UI
 * with all mock-server affordances (dev login, sample-data seeding, fault injection).
 *
 * The "Mocking Bird" flavor replaces this file with `environment.mockingbird.ts` via
 * the `mockingbird` configuration's `fileReplacements` in angular.json.
 */
export const environment = {
  /** Brand shown in the header / login card / page title. */
  brand: 'mastodon_mock',
  /**
   * When true, the UI exposes mock-server-only surface: the "Mock Login" and
   * "Mock Init" login tabs, the fault-injection page, and the `_mock/*` API calls.
   * The standalone Mocking Bird client builds with this off.
   */
  mockTooling: true,
  /**
   * When true the UI may default to talking to its own origin ("this server").
   * Mocking Bird has no own server, so it forces the user to pick an instance.
   */
  allowThisServer: true,
  /** Public OAuth client id. Set this to the app key from the Dropbox App Console. */
  dropboxAppKey: 'tx5g7f50ty6r3df',
  /**
   * Public OAuth client id for Blogger, from a Google Cloud "web application"
   * credential. Public like the Dropbox key: PKCE carries the proof, so the
   * client *secret* is neither needed nor safe to ship — never put it here.
   *
   * Empty hides the connector entirely. To fill it in, the same OAuth client
   * must list this build's callback as an authorized redirect URI:
   * `<origin>/integrations/blogger/callback`.
   */
  bloggerClientId: '',
  /**
   * Public WorkOS client id for Mawkingbird accounts, from the WorkOS
   * dashboard. Public like the two ids above: AuthKit runs as a *public
   * client*, so PKCE carries the proof and the WorkOS API key (`sk_…`) is
   * neither needed in the browser nor safe to ship — never put it here.
   *
   * Empty disables the account feature entirely, which is the correct setting
   * for this build: the mock-embedded UI at `/_ui/` is mastodon_mock's own
   * admin/test surface and has no business signing anyone into a Mawkingbird
   * account. Only the Mocking Bird flavor fills this in.
   */
  workosClientId: '',
};
