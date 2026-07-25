import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FeatureFlagId, FeatureFlags } from './feature-flags';

/** Keep disabled feature routes from being opened through a saved deep link. */
export const featureFlagGuard: CanActivateFn = (route) => {
  const flags = inject(FeatureFlags);
  const id = route.data['featureFlag'] as FeatureFlagId;
  return flags.enabled(id) || inject(Router).parseUrl('/home');
};
