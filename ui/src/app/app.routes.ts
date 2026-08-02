import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { adminGuard } from './admin/admin.guard';
import {
  anonymousChatGuard,
  anonymousUnavailableGuard,
} from './providers/anonymous/anonymous-route.guard';
import { anonymousOnlyGuard } from './providers/anonymous/anonymous-only.guard';
import { featureFlagGuard } from './feature-flag.guard';
import { inviteAccessGuard } from './invites/invite-access.guard';
// Mock-only routes; file-replaced with an empty list in the Mocking Bird build.
import { mockOnlyChildren } from './mock-routes';

export const routes: Routes = [
  {
    path: 'anonymous',
    loadComponent: () =>
      import('./pages/anonymous-entry/anonymous-entry').then((m) => m.AnonymousEntry),
  },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  // New-user landing: bookmark this, sign up on your instance, come back and sign in.
  {
    path: 'welcome-back',
    loadComponent: () => import('./pages/welcome-back/welcome-back').then((m) => m.WelcomeBack),
  },
  {
    path: 'explore',
    loadComponent: () => import('./pages/explore/explore').then((m) => m.Explore),
  },
  // Public recruiting tool in the normal three-column shell. Fresh visitors
  // enter Anonymous against ?server.example (mastodon.social by default).
  {
    path: 'invites',
    canActivate: [inviteAccessGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/invites/invites').then((m) => m.Invites),
      },
    ],
  },
  // A message shared as a TinyURL short link. Un-guarded so a shared link opens
  // for anyone, signed in or not.
  {
    path: 'message/:id',
    loadComponent: () => import('./pages/message/message').then((m) => m.MessagePage),
  },
  {
    path: 'message',
    loadComponent: () => import('./pages/message/message').then((m) => m.MessagePage),
  },
  {
    path: 'integrations/dropbox/callback',
    loadComponent: () =>
      import('./pages/dropbox-callback/dropbox-callback').then((m) => m.DropboxCallback),
  },
  {
    path: 'integrations/openrouter/callback',
    loadComponent: () =>
      import('./pages/openrouter-callback/openrouter-callback').then((m) => m.OpenRouterCallback),
  },
  {
    path: 'fail-whale',
    loadComponent: () =>
      import('./pages/fail-whale-demo/fail-whale-demo').then((m) => m.FailWhaleDemo),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
      {
        path: 'algo',
        loadComponent: () => import('./pages/algo/algo').then((m) => m.Algo),
      },
      {
        path: 'public',
        loadComponent: () =>
          import('./pages/public-timeline/public-timeline').then((m) => m.PublicTimeline),
      },
      {
        path: 'notifications',
        canActivate: [anonymousUnavailableGuard],
        data: { anonymousFeature: 'Inbox' },
        loadComponent: () =>
          import('./pages/notifications/notifications').then((m) => m.Notifications),
      },
      {
        path: 'conversations',
        canActivate: [anonymousChatGuard],
        data: { anonymousFeature: 'Chat' },
        loadComponent: () =>
          import('./pages/conversations/conversations').then((m) => m.Conversations),
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings-shell').then((m) => m.SettingsShell),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'profile' },
          {
            path: 'profile',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/profile/settings-profile').then((m) => m.SettingsProfile),
          },
          {
            path: 'server',
            canActivate: [anonymousOnlyGuard],
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/server/settings-server').then((m) => m.SettingsServer),
          },
          {
            path: 'anonymous',
            canActivate: [anonymousOnlyGuard],
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/anonymous/settings-anonymous').then(
                (m) => m.SettingsAnonymous,
              ),
          },
          {
            path: 'blue',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/blue/settings-blue').then((m) => m.SettingsBlue),
          },
          {
            // Componentless parent: the catalog is the '' child and each
            // connector is a sibling, so a connector's page replaces the
            // catalog rather than nesting under it. Only the catalog is
            // preloaded — the point of the split is that you don't download
            // Bluesky's page to look at the list.
            path: 'connections',
            children: [
              {
                path: '',
                data: { preloadSettings: true },
                loadComponent: () =>
                  import('./pages/settings/connections/settings-connections').then(
                    (m) => m.SettingsConnections,
                  ),
              },
              {
                path: 'github',
                loadComponent: () =>
                  import('./pages/settings/connections/github/connection-github').then(
                    (m) => m.ConnectionGitHub,
                  ),
              },
              {
                path: 'dropbox',
                loadComponent: () =>
                  import('./pages/settings/connections/dropbox/connection-dropbox').then(
                    (m) => m.ConnectionDropbox,
                  ),
              },
              {
                path: 'raindrop',
                loadComponent: () =>
                  import('./pages/settings/connections/raindrop/connection-raindrop').then(
                    (m) => m.ConnectionRaindrop,
                  ),
              },
              {
                path: 'openrouter',
                loadComponent: () =>
                  import('./pages/settings/connections/openrouter/connection-openrouter').then(
                    (m) => m.ConnectionOpenRouter,
                  ),
              },
              {
                path: 'bluesky',
                loadComponent: () =>
                  import('./pages/settings/connections/bluesky/connection-bluesky').then(
                    (m) => m.ConnectionBluesky,
                  ),
              },
              {
                path: 'cors-proxy',
                loadComponent: () =>
                  import('./pages/settings/connections/cors-proxy/connection-cors-proxy').then(
                    (m) => m.ConnectionCorsProxy,
                  ),
              },
              {
                path: 'link-shortener',
                loadComponent: () =>
                  import('./pages/settings/connections/link-shortener/connection-link-shortener').then(
                    (m) => m.ConnectionLinkShortener,
                  ),
              },
              {
                path: 'twitter',
                loadComponent: () =>
                  import('./pages/settings/connections/twitter/connection-twitter').then(
                    (m) => m.ConnectionTwitter,
                  ),
              },
              {
                // Not a connector, but it belongs under the connections tree:
                // it answers "which of these is worth setting up on this
                // network?", which is a question about all of them at once.
                path: 'doctor',
                loadComponent: () =>
                  import('./pages/settings/connections/doctor/connection-doctor-page').then(
                    (m) => m.ConnectionDoctorPage,
                  ),
              },
            ],
          },
          {
            path: 'rss',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/rss/settings-rss').then((m) => m.SettingsRss),
          },
          {
            path: 'privacy',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Privacy and reach settings', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/privacy/settings-privacy').then((m) => m.SettingsPrivacy),
          },
          {
            path: 'appearance',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/appearance/settings-appearance').then(
                (m) => m.SettingsAppearance,
              ),
          },
          {
            path: 'storage',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/storage/settings-storage').then((m) => m.SettingsStorage),
          },
          {
            // 'spotlight', not 'ads': the rail's markup already dodges `ad-*`
            // class names because blockers hide them (right-rail.spec pins it),
            // and a deep-linked path containing /ads is the same hazard one
            // layer out. The page is titled "Ads" where it counts.
            path: 'spotlight',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/spotlight/settings-spotlight').then(
                (m) => m.SettingsSpotlight,
              ),
          },
          {
            // Account-level cleanup of saved credentials and their local data —
            // the coarse counterpart to the key-by-key 'storage' page above.
            path: 'accounts',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/accounts/settings-accounts').then((m) => m.SettingsAccounts),
          },
          {
            path: 'posting',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Posting defaults', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/posting/settings-posting').then((m) => m.SettingsPosting),
          },
          {
            path: 'notifications',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Email notifications', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/notifications/settings-notifications').then(
                (m) => m.SettingsNotifications,
              ),
          },
          {
            path: 'follows',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Follow request approval', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/follows/settings-follows').then((m) => m.SettingsFollows),
          },
          {
            path: 'mutes',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Muted accounts', kind: 'mutes', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/account-list/settings-account-list').then(
                (m) => m.SettingsAccountList,
              ),
          },
          {
            path: 'blocks',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Blocked accounts', kind: 'blocks', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/account-list/settings-account-list').then(
                (m) => m.SettingsAccountList,
              ),
          },
          {
            // Whole-account operations (retweets for every follow, mute/block
            // amnesty). Server-backed throughout, so Anonymous can't use it.
            path: 'bulk-actions',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Bulk actions', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/bulk-actions/settings-bulk-actions').then(
                (m) => m.SettingsBulkActions,
              ),
          },
          {
            path: 'filters',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Content filters', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/filters/settings-filters').then((m) => m.SettingsFilters),
          },
          {
            path: 'filters/new',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Content filters', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/filters/settings-filter-edit').then(
                (m) => m.SettingsFilterEdit,
              ),
          },
          {
            path: 'filters/:id',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Content filters', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/filters/settings-filter-edit').then(
                (m) => m.SettingsFilterEdit,
              ),
          },
          {
            path: 'deletion',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Automatic post deletion', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/deletion/settings-deletion').then((m) => m.SettingsDeletion),
          },
          {
            path: 'account',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Account settings', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/account/settings-account').then((m) => m.SettingsAccount),
          },
          {
            path: 'import-export',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Import/Export', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/import-export/settings-import-export').then(
                (m) => m.SettingsImportExport,
              ),
          },
          {
            path: 'config',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/config/settings-config').then((m) => m.SettingsConfig),
          },
          {
            path: 'invites',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Invites', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/invites/settings-invites').then((m) => m.SettingsInvites),
          },
          {
            path: 'i18n',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/i18n/settings-i18n').then((m) => m.SettingsI18n),
          },
          {
            path: 'feature-flags',
            data: { featureFlagSettings: true, preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/feature-flags/settings-feature-flags').then(
                (m) => m.SettingsFeatureFlags,
              ),
          },
          {
            path: 'development',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Development settings', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/development/settings-development').then(
                (m) => m.SettingsDevelopment,
              ),
          },
        ],
      },
      ...mockOnlyChildren,
      {
        path: 'offsite-directories',
        loadComponent: () =>
          import('./pages/offsite-directories/offsite-directories').then(
            (m) => m.OffsiteDirectories,
          ),
      },
      // Was `/find-people`, which promised the same thing as the Find Friends hub
      // and split the "who to follow" links between them. Redirected rather than
      // dropped: the old path is linked from released builds and bookmarks.
      { path: 'find-people', redirectTo: 'offsite-directories', pathMatch: 'full' },
      // The server's opt-in profile directory. Public endpoint, so no auth guard:
      // browsing strangers is exactly what an anonymous visitor is here to do.
      {
        path: 'directory',
        loadComponent: () => import('./pages/directory/directory').then((m) => m.Directory),
      },
      {
        path: 'bundled-collections',
        loadComponent: () =>
          import('./pages/bundled-collections/bundled-collections').then(
            (m) => m.BundledCollections,
          ),
      },
      {
        path: 'bundled-starter-kits',
        loadComponent: () =>
          import('./pages/bundled-starter-kits/bundled-starter-kits').then(
            (m) => m.BundledStarterKits,
          ),
      },
      // `/starter-kits` used to hold both kinds at once. They are two different
      // things — other people's real collections, and ours — so they are two
      // pages now, and the old path lands on the hub that offers both.
      { path: 'starter-kits', redirectTo: 'find-friends', pathMatch: 'full' },
      // Feeds hub: lists, saved searches, server feeds, collections and tags in
      // one page. `/feeds/lists` and `/feeds/tags` are filtered views of the same
      // component (see Feeds.only). These literal segments MUST precede the
      // `feeds/:feed` server-feed route below so they aren't swallowed by it.
      {
        path: 'feeds',
        loadComponent: () => import('./pages/lists/lists').then((m) => m.Lists),
      },
      {
        path: 'feeds/lists',
        data: { only: 'lists' },
        loadComponent: () => import('./pages/lists/lists').then((m) => m.Lists),
      },
      {
        path: 'feeds/tags',
        data: { only: 'tags' },
        loadComponent: () => import('./pages/lists/lists').then((m) => m.Lists),
      },
      // One saved Bluesky feed or list. `:ref` is `<kind>:<at-uri>`; it sits
      // above `feeds/:feed` for the same reason the two literals above do.
      {
        path: 'feeds/bluesky/:ref',
        loadComponent: () =>
          import('./pages/bluesky-feed/bluesky-feed').then((m) => m.BlueskyFeedPage),
      },
      // Back-compat: the old top-level Lists/Tags entries now live under Feeds.
      { path: 'lists', pathMatch: 'full', redirectTo: 'feeds/lists' },
      { path: 'tags', pathMatch: 'full', redirectTo: 'feeds/tags' },
      {
        path: 'search',
        loadComponent: () => import('./pages/search/search').then((m) => m.Search),
      },
      {
        path: 'favourites',
        canActivate: [anonymousUnavailableGuard],
        data: { anonymousFeature: 'Favourites' },
        loadComponent: () => import('./pages/favourites/favourites').then((m) => m.Favourites),
      },
      {
        path: 'bookmarks',
        loadComponent: () => import('./pages/bookmarks/bookmarks').then((m) => m.Bookmarks),
      },
      {
        path: 'analytics',
        canActivate: [anonymousUnavailableGuard],
        data: { anonymousFeature: 'Analytics' },
        loadComponent: () => import('./pages/analytics/analytics').then((m) => m.Analytics),
      },
      {
        path: 'observability',
        loadComponent: () =>
          import('./pages/observability/observability').then((m) => m.Observability),
      },
      // Docs hub + the "blog-post"-style pages it links to. Design lives inside
      // the shell now (rendered as a virtual tweet), so the reader keeps the top
      // nav, rails and footer instead of dropping into a bare full-page layout.
      {
        // Route is `/blog` (the user's framing: these are "blog-post"-style
        // pages), not `/docs` — the mock backend's FastAPI serves Swagger UI at
        // `/docs`, so an in-app `/docs` route would be shadowed on hard-nav.
        path: 'blog',
        loadComponent: () => import('./pages/docs/docs').then((m) => m.Docs),
      },
      {
        // "Design" — the project story, as a virtual tweet in the centre column.
        path: 'about',
        loadComponent: () => import('./pages/about/about').then((m) => m.About),
      },
      {
        // "Funding" — who pays for what, also a virtual tweet. Its own route
        // rather than a tail section of Design, so it can be linked to.
        path: 'funding',
        loadComponent: () => import('./pages/funding/funding').then((m) => m.Funding),
      },
      {
        path: 'server-rules',
        loadComponent: () => import('./pages/server-rules/server-rules').then((m) => m.ServerRules),
      },
      {
        path: 'terms',
        loadComponent: () => import('./pages/terms/terms').then((m) => m.Terms),
      },
      {
        path: 'credits',
        loadComponent: () => import('./pages/credits/credits').then((m) => m.Credits),
      },
      {
        path: 'drafts',
        loadComponent: () => import('./pages/drafts/drafts-page').then((m) => m.DraftsPage),
      },
      {
        path: 'pastes',
        canActivate: [featureFlagGuard],
        data: { featureFlag: 'pastebin' },
        loadComponent: () => import('./pages/pastes/pastes-page').then((m) => m.PastesPage),
      },
      {
        path: 'links',
        canActivate: [featureFlagGuard],
        data: { featureFlag: 'links' },
        loadComponent: () => import('./pages/links/links-page').then((m) => m.LinksPage),
      },
      {
        path: 'find-friends',
        loadComponent: () => import('./pages/find-friends/find-friends').then((m) => m.FindFriends),
      },
      {
        path: 'lists/:id',
        loadComponent: () =>
          import('./pages/list-timeline/list-timeline').then((m) => m.ListTimeline),
      },
      {
        path: 'feeds/:feed',
        loadComponent: () => import('./pages/server-feed/server-feed').then((m) => m.ServerFeed),
      },
      {
        path: 'endorsed/:accountId',
        loadComponent: () =>
          import('./pages/endorsed-list/endorsed-list').then((m) => m.EndorsedList),
      },
      {
        path: 'collections/starter',
        loadComponent: () =>
          import('./pages/starter-collection/starter-collection').then((m) => m.StarterCollection),
      },
      {
        path: 'collections/preview/:id',
        loadComponent: () => import('./pages/collection/collection').then((m) => m.CollectionPage),
      },
      {
        path: 'collections/:id',
        canActivate: [anonymousUnavailableGuard],
        data: { anonymousFeature: 'Collections' },
        loadComponent: () => import('./pages/collection/collection').then((m) => m.CollectionPage),
      },
      {
        path: 'tags/:tag',
        loadComponent: () => import('./pages/tag/tag').then((m) => m.Tag),
      },
      {
        path: 'unavailable',
        loadComponent: () => import('./pages/unavailable/unavailable').then((m) => m.Unavailable),
      },
      {
        path: 'statuses/:id',
        loadComponent: () => import('./pages/thread/thread').then((m) => m.Thread),
      },
      {
        // Friendly alias for Eliza's synthetic profile (id `eliza:self`).
        path: 'eliza',
        redirectTo: 'accounts/eliza:self',
        pathMatch: 'full',
      },
      {
        // The same for OpenRouter's (id `openrouter:self`). The profile itself
        // reports "not found" unless a key is connected and AI is on.
        path: 'openrouter',
        redirectTo: 'accounts/openrouter:self',
        pathMatch: 'full',
      },
      {
        // Eliza's chat and inbox used to live on their own routes, outside the
        // ordinary chat surface. Both are gone: she is now one correspondent in
        // Conversations like any other, and her notification inbox has been
        // removed entirely. Redirected rather than deleted so old bookmarks and
        // any link still pointing here land somewhere sensible.
        path: 'eliza/chat',
        redirectTo: 'conversations',
        pathMatch: 'full',
      },
      {
        path: 'eliza/inbox',
        redirectTo: 'conversations',
        pathMatch: 'full',
      },
      {
        path: 'accounts/:id',
        loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./admin/admin-shell/admin-shell').then((m) => m.AdminShell),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'accounts' },
          {
            path: 'accounts',
            loadComponent: () =>
              import('./admin/accounts/admin-accounts').then((m) => m.AdminAccounts),
          },
          {
            path: 'reports',
            loadComponent: () =>
              import('./admin/reports/admin-reports').then((m) => m.AdminReports),
          },
          {
            path: 'domains',
            loadComponent: () =>
              import('./admin/domains/admin-domains').then((m) => m.AdminDomains),
          },
          {
            path: 'domain-allows',
            loadComponent: () =>
              import('./admin/domain-allows/admin-domain-allows').then((m) => m.AdminDomainAllows),
          },
          {
            path: 'email-blocks',
            loadComponent: () =>
              import('./admin/email-blocks/admin-email-blocks').then((m) => m.AdminEmailBlocks),
          },
          {
            path: 'canonical-blocks',
            loadComponent: () =>
              import('./admin/canonical-blocks/admin-canonical-blocks').then(
                (m) => m.AdminCanonicalBlocks,
              ),
          },
          {
            path: 'ip-blocks',
            loadComponent: () =>
              import('./admin/ip-blocks/admin-ip-blocks').then((m) => m.AdminIpBlocks),
          },
          {
            path: 'announcements',
            loadComponent: () =>
              import('./admin/announcements/admin-announcements').then((m) => m.AdminAnnouncements),
          },
          {
            path: 'trends',
            loadComponent: () => import('./admin/trends/admin-trends').then((m) => m.AdminTrends),
          },
          {
            path: 'metrics',
            loadComponent: () =>
              import('./admin/metrics/admin-metrics').then((m) => m.AdminMetrics),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
