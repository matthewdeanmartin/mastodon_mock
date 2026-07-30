import { Component, inject } from '@angular/core';
import { HouseAdStore } from '../../../house-ad-store';
import { HOUSE_ADS_SHOWN } from '../../../house-ads';

/**
 * Settings → Ads: the whole inventory, what you clicked, and the off switches.
 *
 * Reachable at `/settings/spotlight` rather than `/settings/ads`. The rail's
 * markup already avoids `ad-*` class names because blockers hide those
 * cosmetically (there is a test pinning that); a deep link whose path contains
 * `/ads` is the same hazard one layer out, and the label the user sees is "Ads"
 * either way. The CSS classes here follow the rail's `spotlight-` naming for
 * exactly the same reason.
 *
 * Every control applies immediately. There is no Save button because there is
 * nothing to submit — this is browser-local state, and the rail reads the same
 * signals, so a toggle here changes the rail on the next render.
 */
@Component({
  selector: 'app-settings-spotlight',
  templateUrl: './settings-spotlight.html',
  styleUrl: './settings-spotlight.css',
})
export class SettingsSpotlight {
  protected readonly store = inject(HouseAdStore);
  protected readonly shown = HOUSE_ADS_SHOWN;

  /** "28 Jul 2026", or '' when the timestamp is missing or unparseable. */
  protected clickedOn(iso: string): string {
    if (!iso) {
      return '';
    }
    const when = new Date(iso);
    return Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
