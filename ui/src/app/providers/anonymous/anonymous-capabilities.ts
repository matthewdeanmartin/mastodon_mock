import { inject, Injectable } from '@angular/core';
import { Auth } from '../../auth';
import { ProviderId } from '../../models';
import { PROVIDER_CAPS, ProviderCapabilities } from '../provider';

/**
 * Central policy for features that require a real signed-in identity.
 *
 * Shared UI asks this service instead of scattering Anonymous checks. The
 * local implementations for follows, bookmarks, lists, and tags can turn
 * individual capabilities back on in their delivery sprints.
 */
@Injectable({ providedIn: 'root' })
export class AnonymousCapabilities {
  private auth = inject(Auth);

  get active(): boolean {
    return this.auth.isAnonymous;
  }

  get canCompose(): boolean {
    return !this.active;
  }

  get canManageRelationships(): boolean {
    return !this.active;
  }

  /** Follow/Unfollow has a complete browser-local implementation in Anonymous. */
  readonly canFollow = true;
  readonly canManageLists = true;

  get canUseServerActions(): boolean {
    return !this.active;
  }

  readonly canBookmark = true;

  get canUseBluesky(): boolean {
    return !this.active;
  }

  statusCaps(provider: ProviderId): ProviderCapabilities {
    if (this.active) {
      return { reply: false, favourite: false, reblog: false };
    }
    return PROVIDER_CAPS[provider];
  }
}
