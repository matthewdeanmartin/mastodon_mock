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
};
