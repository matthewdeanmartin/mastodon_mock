import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../../auth';
import { environment } from '../../../environments/environment';
import { SettingsPreloading } from './settings-preloading';

interface SettingsNavItem {
  label: string;
  path: string;
  /** Match child routes too (the Filters editor lives under /settings/filters/...). */
  exact: boolean;
  /** True for pages backed by /api/v1/_mock endpoints; hidden against real servers. */
  mockOnly?: boolean;
  /** Safe and useful for the one browser-local Anonymous account. */
  anonymous?: boolean;
  /** Meaningful only for the browser-local Anonymous account. */
  anonymousOnly?: boolean;
}

/**
 * Full-width settings area: 2018-Twitter-style boxed sidebar on the left
 * (profile card + category list), routed content pane on the right. Category
 * grouping mirrors mastodon.social's settings.
 */
@Component({
  selector: 'app-settings-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './settings-shell.html',
  styleUrl: './settings-shell.css',
})
export class SettingsShell {
  protected auth = inject(Auth);
  private readonly preloading = inject(SettingsPreloading);

  constructor() {
    // The router preloader runs after navigation completes. Enabling it while
    // entering Settings makes the sibling page bundles available for later clicks.
    this.preloading.enable();
  }

  protected readonly nav: SettingsNavItem[] = [
    { label: 'Public profile', path: 'profile', exact: true, anonymous: true },
    { label: 'Server', path: 'server', exact: true, anonymous: true, anonymousOnly: true },
    { label: 'Anonymous', path: 'anonymous', exact: true, anonymous: true, anonymousOnly: true },
    // Client-side premium-style features; the same controls also live in Appearance.
    { label: 'Mockingbird Blue', path: 'blue', exact: true, anonymous: true },
    // Client-side (localStorage): RSS feeds now, Bluesky next. Works anywhere.
    { label: 'Connections', path: 'connections', exact: true, anonymous: true },
    { label: 'Privacy and reach', path: 'privacy', exact: true },
    // Appearance is client-side (theme/accent/undo-send in localStorage) and works
    // against any instance; the page hides its server-backed rows off-mock itself.
    { label: 'Appearance', path: 'appearance', exact: true, anonymous: true },
    { label: 'Local storage', path: 'storage', exact: true, anonymous: true },
    { label: 'Posting defaults', path: 'posting', exact: true },
    { label: 'Email notifications', path: 'notifications', exact: true, mockOnly: true },
    { label: 'Approve follow requests', path: 'follows', exact: true },
    { label: 'Muted accounts', path: 'mutes', exact: true },
    { label: 'Blocked accounts', path: 'blocks', exact: true },
    { label: 'Filters', path: 'filters', exact: false },
    { label: 'Automatic post deletion', path: 'deletion', exact: true, mockOnly: true },
    { label: 'Account', path: 'account', exact: true },
    { label: 'Import/Export', path: 'import-export', exact: true },
    { label: 'Invite people', path: 'invites', exact: true, mockOnly: true },
    { label: 'Development', path: 'development', exact: true, mockOnly: true },
  ].filter(
    (item) =>
      (environment.mockTooling || !item.mockOnly) &&
      (!this.auth.isAnonymous || item.anonymous) &&
      (this.auth.isAnonymous || !item.anonymousOnly),
  );
}
