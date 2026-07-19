import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { adminGuard } from './admin/admin.guard';
// Mock-only routes; file-replaced with an empty list in the Mocking Bird build.
import { mockOnlyChildren } from './mock-routes';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  // New-user landing: bookmark this, sign up on your instance, come back and sign in.
  {
    path: 'welcome-back',
    loadComponent: () =>
      import('./pages/welcome-back/welcome-back').then((m) => m.WelcomeBack),
  },
  {
    path: 'explore',
    loadComponent: () => import('./pages/explore/explore').then((m) => m.Explore),
  },
  // One-click, logged-out demo: read-only live posts from a public instance.
  { path: 'demo', loadComponent: () => import('./pages/demo/demo').then((m) => m.Demo) },
  // The project story should be available before a visitor has an account.
  { path: 'about', loadComponent: () => import('./pages/about/about').then((m) => m.About) },
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
      { path: 'algo', loadComponent: () => import('./pages/algo/algo').then((m) => m.Algo) },
      {
        path: 'public',
        loadComponent: () =>
          import('./pages/public-timeline/public-timeline').then((m) => m.PublicTimeline),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./pages/notifications/notifications').then((m) => m.Notifications),
      },
      {
        path: 'conversations',
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
            data: { preloadSettings: true },
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
            path: 'posting',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/posting/settings-posting').then((m) => m.SettingsPosting),
          },
          {
            path: 'notifications',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/notifications/settings-notifications').then(
                (m) => m.SettingsNotifications,
              ),
          },
          {
            path: 'follows',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/follows/settings-follows').then((m) => m.SettingsFollows),
          },
          {
            path: 'mutes',
            data: { kind: 'mutes', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/account-list/settings-account-list').then(
                (m) => m.SettingsAccountList,
              ),
          },
          {
            path: 'blocks',
            data: { kind: 'blocks', preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/account-list/settings-account-list').then(
                (m) => m.SettingsAccountList,
              ),
          },
          {
            path: 'filters',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/filters/settings-filters').then((m) => m.SettingsFilters),
          },
          {
            path: 'filters/new',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/filters/settings-filter-edit').then(
                (m) => m.SettingsFilterEdit,
              ),
          },
          {
            path: 'filters/:id',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/filters/settings-filter-edit').then(
                (m) => m.SettingsFilterEdit,
              ),
          },
          {
            path: 'deletion',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/deletion/settings-deletion').then((m) => m.SettingsDeletion),
          },
          {
            path: 'account',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/account/settings-account').then((m) => m.SettingsAccount),
          },
          {
            path: 'import-export',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/import-export/settings-import-export').then(
                (m) => m.SettingsImportExport,
              ),
          },
          {
            path: 'invites',
            data: { preloadSettings: true },
            loadComponent: () =>
              import('./pages/settings/invites/settings-invites').then((m) => m.SettingsInvites),
          },
          {
            path: 'development',
            data: { preloadSettings: true },
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
        loadComponent: () => import('./pages/favourites/favourites').then((m) => m.Favourites),
      },
      {
        path: 'bookmarks',
        loadComponent: () => import('./pages/bookmarks/bookmarks').then((m) => m.Bookmarks),
      },
      { path: 'lists', loadComponent: () => import('./pages/lists/lists').then((m) => m.Lists) },
      {
        path: 'analytics',
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
        loadComponent: () => import('./pages/drafts/drafts-page').then((m) => m.DraftsPage),
      },
      {
        path: 'lists/:id',
        loadComponent: () =>
          import('./pages/list-timeline/list-timeline').then((m) => m.ListTimeline),
      },
      {
        path: 'collections/:id',
        loadComponent: () => import('./pages/collection/collection').then((m) => m.CollectionPage),
      },
      { path: 'tags/:tag', loadComponent: () => import('./pages/tag/tag').then((m) => m.Tag) },
      {
        path: 'statuses/:id',
        loadComponent: () => import('./pages/thread/thread').then((m) => m.Thread),
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
