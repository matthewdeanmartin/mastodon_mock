import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../../auth';
import { environment } from '../../../environments/environment';

interface SettingsNavItem {
  label: string;
  path: string;
  /** Match child routes too (the Filters editor lives under /settings/filters/...). */
  exact: boolean;
  /** True for pages backed by /api/v1/_mock endpoints; hidden against real servers. */
  mockOnly?: boolean;
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

  protected readonly nav: SettingsNavItem[] = [
    { label: 'Public profile', path: 'profile', exact: true },
    { label: 'Privacy and reach', path: 'privacy', exact: true },
    { label: 'Appearance', path: 'appearance', exact: true, mockOnly: true },
    { label: 'Posting defaults', path: 'posting', exact: true },
    { label: 'Email notifications', path: 'notifications', exact: true, mockOnly: true },
    { label: 'Follows and followers', path: 'follows', exact: true },
    { label: 'Muted accounts', path: 'mutes', exact: true },
    { label: 'Blocked accounts', path: 'blocks', exact: true },
    { label: 'Filters', path: 'filters', exact: false },
    { label: 'Automatic post deletion', path: 'deletion', exact: true, mockOnly: true },
    { label: 'Account', path: 'account', exact: true },
    { label: 'Import and export', path: 'import-export', exact: true, mockOnly: true },
    { label: 'Invite people', path: 'invites', exact: true, mockOnly: true },
    { label: 'Development', path: 'development', exact: true, mockOnly: true },
  ].filter((item) => environment.mockTooling || !item.mockOnly);
}
