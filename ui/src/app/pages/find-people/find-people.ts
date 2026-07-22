import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../auth';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';

/**
 * Onboarding "Phase 1": a home timeline is only as good as who you follow, and a
 * brand-new account follows nobody. This page points at a starter pack,
 * directories, search, and the follow-list importer in Settings.
 */
@Component({
  selector: 'app-find-people',
  imports: [RouterLink],
  templateUrl: './find-people.html',
  styleUrl: './find-people.css',
})
export class FindPeople {
  private auth = inject(Auth);
  private anonymousFollows = inject(AnonymousFollows);

  /** True when hosted inside another page (e.g. search's empty state): no page title. */
  readonly embedded = input(false);

  /** Search's account tab highlights the starter pack only for an empty follow graph. */
  protected hasNoFollows = computed(() =>
    this.auth.isAnonymous
      ? this.anonymousFollows.count() === 0
      : (this.auth.account()?.following_count ?? 0) === 0,
  );
}
