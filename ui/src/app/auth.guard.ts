import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (auth.isAuthenticated) {
    return true;
  }
  // The front page, not the login page: a stranger who has just arrived should
  // see what this app is before being asked to choose a server and grant scopes.
  // `/` offers both "log in" and "continue without logging in".
  return router.parseUrl('/');
};
