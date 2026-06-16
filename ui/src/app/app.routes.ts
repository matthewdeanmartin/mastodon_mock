import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { adminGuard } from './admin/admin.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
      { path: 'public', loadComponent: () => import('./pages/public-timeline/public-timeline').then((m) => m.PublicTimeline) },
      { path: 'notifications', loadComponent: () => import('./pages/notifications/notifications').then((m) => m.Notifications) },
      { path: 'search', loadComponent: () => import('./pages/search/search').then((m) => m.Search) },
      { path: 'favourites', loadComponent: () => import('./pages/favourites/favourites').then((m) => m.Favourites) },
      { path: 'bookmarks', loadComponent: () => import('./pages/bookmarks/bookmarks').then((m) => m.Bookmarks) },
      { path: 'lists', loadComponent: () => import('./pages/lists/lists').then((m) => m.Lists) },
      { path: 'lists/:id', loadComponent: () => import('./pages/list-timeline/list-timeline').then((m) => m.ListTimeline) },
      { path: 'tags/:tag', loadComponent: () => import('./pages/tag/tag').then((m) => m.Tag) },
      { path: 'statuses/:id', loadComponent: () => import('./pages/thread/thread').then((m) => m.Thread) },
      { path: 'accounts/:id', loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile) },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./admin/admin-shell/admin-shell').then((m) => m.AdminShell),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'accounts' },
          { path: 'accounts', loadComponent: () => import('./admin/accounts/admin-accounts').then((m) => m.AdminAccounts) },
          { path: 'reports', loadComponent: () => import('./admin/reports/admin-reports').then((m) => m.AdminReports) },
          { path: 'domains', loadComponent: () => import('./admin/domains/admin-domains').then((m) => m.AdminDomains) },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
