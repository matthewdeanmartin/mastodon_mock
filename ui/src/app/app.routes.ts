import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { adminGuard } from './admin/admin.guard';
import { anonymousUnavailableGuard } from './providers/anonymous/anonymous-route.guard';
import { anonymousOnlyGuard } from './providers/anonymous/anonymous-only.guard';
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
  // The project story should be available before a visitor has an account.
  { path: 'about', loadComponent: () => import('./pages/about/about').then((m) => m.About) },
  {
    path: 'integrations/dropbox/callback',
    loadComponent: () =>
      import('./pages/dropbox-callback/dropbox-callback').then((m) => m.DropboxCallback),
  },
  {
    path: 'raindrop',
    loadComponent: () =>
      import('./pages/raindrop-callback/raindrop-callback').then((m) => m.RaindropCallback),
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
        canActivate: [anonymousUnavailableGuard],
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
            path: 'connections',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/connections/settings-connections').then(
                (m) => m.SettingsConnections,
              ),
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
            path: 'invites',
            canActivate: [anonymousUnavailableGuard],
            data: { anonymousFeature: 'Invites', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/invites/settings-invites').then((m) => m.SettingsInvites),
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
        path: 'find-people',
        loadComponent: () => import('./pages/find-people/find-people').then((m) => m.FindPeople),
      },
      {
        path: 'tags',
        loadComponent: () =>
          import('./pages/followed-tags/followed-tags').then((m) => m.FollowedTags),
      },
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
        path: 'lists',
        loadComponent: () => import('./pages/lists/lists').then((m) => m.Lists),
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
        canActivate: [anonymousUnavailableGuard],
        data: { anonymousFeature: 'Drafts' },
        loadComponent: () => import('./pages/drafts/drafts-page').then((m) => m.DraftsPage),
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
        // Eliza's browser-local chat — reachable once you follow her (the
        // component redirects to her profile if you don't). Deliberately NOT
        // behind the anonymous guard: this is the one chat anon users can have.
        path: 'eliza/chat',
        loadComponent: () => import('./eliza/eliza-chat').then((m) => m.ElizaChat),
      },
      {
        // Eliza's browser-local inbox — her replies, DMs, and welcome. Also
        // follow-gated and outside the anonymous guard.
        path: 'eliza/inbox',
        loadComponent: () => import('./eliza/eliza-inbox').then((m) => m.ElizaInbox),
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
