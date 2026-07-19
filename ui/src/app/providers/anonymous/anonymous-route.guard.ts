import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '../../auth';

/** Redirect authenticated-only pages before their components can issue API calls. */
export const anonymousUnavailableGuard: CanActivateFn = (route) => {
  if (!inject(Auth).isAnonymous) {
    return true;
  }
  const feature = String(route.data?.['anonymousFeature'] ?? 'This feature');
  return inject(Router).createUrlTree(['/unavailable'], { queryParams: { feature } });
};
