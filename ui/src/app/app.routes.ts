import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

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
      { path: 'statuses/:id', loadComponent: () => import('./pages/thread/thread').then((m) => m.Thread) },
      { path: 'accounts/:id', loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile) },
    ],
  },
  { path: '**', redirectTo: '' },
];
