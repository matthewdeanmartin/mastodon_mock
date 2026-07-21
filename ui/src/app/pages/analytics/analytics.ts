import { Component, computed, inject } from '@angular/core';
import { Auth } from '../../auth';
import { AccountAnalytics } from '../../account-analytics/account-analytics';

/**
 * The standalone /analytics page: analytics for the logged-in account. The
 * actual crunching lives in the reusable {@link AccountAnalytics} component,
 * which the profile page also embeds behind a tab for any account.
 */
@Component({
  selector: 'app-analytics',
  imports: [AccountAnalytics],
  templateUrl: './analytics.html',
  styleUrl: './analytics.css',
})
export class Analytics {
  private auth = inject(Auth);
  protected me = computed(() => this.auth.account());
}
