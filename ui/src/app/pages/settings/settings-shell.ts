import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../../auth';
import { environment } from '../../../environments/environment';
import { FeatureFlagId, FeatureFlags } from '../../feature-flags';
import { SettingsPreloading } from './settings-preloading';

interface SettingsNavItem {
  label: string;
  path: string;
  /** Match child routes too (the Filters editor lives under /settings/filters/...). */
  exact: boolean;
  /** True for pages backed by /api/v1/_mock endpoints; hidden against real servers. */
  mockOnly?: boolean;
  /** Safe and useful for the one browser-local Anonymous account. */
  anonymous?: boolean;
  /** Meaningful only for the browser-local Anonymous account. */
  anonymousOnly?: boolean;
  /** Hidden unless this feature flag is on. */
  featureFlag?: FeatureFlagId;
}

/** A heading in the sidebar, and the pages filed under it. */
interface SettingsNavGroup {
  title: string;
  /** Item paths, in the order they should appear under the heading. */
  paths: string[];
}

/**
 * The four shelves the settings pages sit on.
 *
 * A page may appear under more than one heading, and several do. There is no
 * one true partition of settings into categories — ours would not match the
 * user's anyway — so when a page has a real claim to two shelves it goes on
 * both, and whichever one the user looked under first is the right one. The
 * cost is a duplicated row in a list; the alternative is a user who cannot find
 * a setting that is definitely there.
 *
 * "Basic" is the catch-all and is listed first: anything not deliberately filed
 * elsewhere still appears there, so no page can fall out of the sidebar by
 * being forgotten here.
 */
const NAV_GROUPS: SettingsNavGroup[] = [
  {
    title: 'Basic',
    // Pages that belong here *as well as* under a more specific heading. Anything
    // not named in any group lands here too — see `groups` below — so this list
    // is only for deliberate cross-listing, not for the ordinary case.
    paths: ['profile', 'writing', 'privacy', 'appearance'],
  },
  {
    title: 'People',
    paths: [
      'moderation',
      'follows',
      'filters',
      'content',
      'bulk-actions',
      'import-export',
      'invites',
      'privacy',
    ],
  },
  {
    title: 'Accounts',
    paths: ['accounts', 'account', 'mawkingbird-plus', 'connections', 'rss', 'server', 'profile'],
  },
  {
    title: 'Advanced',
    paths: ['storage', 'feature-flags', 'development', 'config', 'deletion'],
  },
];

/**
 * Full-width settings area: 2018-Twitter-style boxed sidebar on the left
 * (profile card + category list), routed content pane on the right. The
 * category headings are always expanded — the list is long, and a collapsed
 * group is a place for a setting to hide.
 */
@Component({
  selector: 'app-settings-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './settings-shell.html',
  styleUrl: './settings-shell.css',
})
export class SettingsShell {
  protected auth = inject(Auth);
  private readonly flags = inject(FeatureFlags);
  private readonly preloading = inject(SettingsPreloading);

  constructor() {
    // The router preloader runs after navigation completes. Enabling it while
    // entering Settings makes the sibling page bundles available for later clicks.
    this.preloading.enable();
  }

  // The element type is annotated on the literal rather than only on `nav`:
  // `.filter()` breaks the contextual-typing chain, so without it `featureFlag`
  // widens to `string` and stops being checked against `FeatureFlagId`.
  protected readonly nav: SettingsNavItem[] = (
    [
      { label: 'Public profile', path: 'profile', exact: true, anonymous: true },
      { label: 'Server', path: 'server', exact: true, anonymous: true, anonymousOnly: true },
      // Client-side premium-style features; the same controls also live in Appearance.
      { label: 'Mockingbird Blue', path: 'blue', exact: true, anonymous: true },
      // A Mawkingbird account. `anonymous: true` because the account belongs to
      // the human, not to a Mastodon persona — the same reasoning that makes the
      // CORS proxy key account-unscoped in `cors-proxy-settings.ts`.
      {
        label: 'Mawkingbird Plus',
        path: 'mawkingbird-plus',
        exact: true,
        anonymous: true,
        featureFlag: 'mawkingbird-plus',
      },
      // Client-side (localStorage) accounts on other services: Bluesky, GitHub,
      // Raindrop.io, Dropbox. Not exact — the catalog's child pages live under it.
      { label: 'Connections', path: 'connections', exact: false, anonymous: true },
      // Many feeds rather than one account, so deliberately not a "connection".
      { label: 'RSS feeds', path: 'rss', exact: true, anonymous: true },
      { label: 'Privacy', path: 'privacy', exact: true },
      { label: 'Writing', path: 'writing', exact: true, anonymous: true },
      // Appearance is client-side (theme/accent/undo-send in localStorage) and works
      // against any instance; the page hides its server-backed rows off-mock itself.
      { label: 'Appearance', path: 'appearance', exact: true, anonymous: true },
      { label: 'Internationalization', path: 'i18n', exact: true, anonymous: true },
      { label: 'Local storage', path: 'storage', exact: true, anonymous: true },
      // Path is 'spotlight' on purpose — see the route's comment in app.routes.ts.
      { label: 'Ads', path: 'spotlight', exact: true, anonymous: true },
      { label: 'Signed-in accounts', path: 'accounts', exact: true, anonymous: true },
      { label: 'Email notifications', path: 'notifications', exact: true, mockOnly: true },
      { label: 'Approve follow requests', path: 'follows', exact: true },
      { label: 'Muted & Blocked', path: 'moderation', exact: true },
      // The flipside of the line above — accounts you want *without* a doorway in
      // front of them — so it sits next to it. Client-side, hence anonymous: true.
      { label: 'Content warnings', path: 'content', exact: true, anonymous: true },
      // Sits under the two lists it can empty, and next to the follow-wide
      // retweet switches, because that is what all four of them operate on.
      { label: 'Bulk actions', path: 'bulk-actions', exact: true },
      { label: 'Filters', path: 'filters', exact: false },
      { label: 'Automatic post deletion', path: 'deletion', exact: true, mockOnly: true },
      { label: 'Account', path: 'account', exact: true },
      { label: 'Import/Export Friends', path: 'import-export', exact: true },
      { label: 'Import/Export Config', path: 'config', exact: true, anonymous: true },
      // "Invite links", not "Invite people": /invites is the page that invites
      // people, and two menu entries reading the same thing is a maze.
      { label: 'Invite links', path: 'invites', exact: true, mockOnly: true },
      { label: 'Feature flags', path: 'feature-flags', exact: true, anonymous: true },
      { label: 'Development', path: 'development', exact: true, mockOnly: true },
    ] satisfies SettingsNavItem[]
  ).filter(
    (item) =>
      (environment.mockTooling || !item.mockOnly) &&
      (!this.auth.isAnonymous || item.anonymous) &&
      (this.auth.isAnonymous || !item.anonymousOnly) &&
      (!item.featureFlag || this.flags.enabled(item.featureFlag)),
  );

  /**
   * The visible nav, bucketed under headings.
   *
   * Built from {@link nav} rather than from the group lists, so a page hidden by
   * a feature flag, the mock-tooling check or the anonymous guards stays hidden
   * in every group it is named in. Empty groups drop out entirely, which is what
   * keeps the Anonymous account from staring at a "People" heading with nothing
   * under it.
   */
  protected readonly groups: { title: string; items: SettingsNavItem[] }[] = (() => {
    const byPath = new Map(this.nav.map((item) => [item.path, item]));
    const filed = new Set(NAV_GROUPS.flatMap((g) => g.paths));
    return NAV_GROUPS.map((group) => ({
      title: group.title,
      items:
        group.title === 'Basic'
          ? // Its own cross-listed pages first, then every page nobody filed
            // anywhere — a page left out of the lists is still a page the user
            // needs to reach, and silently dropping it is the one outcome this
            // whole arrangement must not have.
            [
              ...group.paths
                .map((path) => byPath.get(path))
                .filter((item): item is SettingsNavItem => !!item),
              ...this.nav.filter((item) => !filed.has(item.path)),
            ]
          : group.paths
              .map((path) => byPath.get(path))
              .filter((item): item is SettingsNavItem => !!item),
    })).filter((group) => group.items.length > 0);
  })();
}
