import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ACCENT_PRESETS, ClientPrefs } from '../../../client-prefs';
import { Terminology } from '../../../terminology';

/**
 * The Mockingbird Blue control cluster: theme, accent, undo-send and reader
 * typography. All settings live in localStorage (ClientPrefs) and apply
 * instantly. Shared by the "Mockingbird Blue" settings page and Appearance,
 * so the same controls are findable in both places.
 */
@Component({
  selector: 'app-blue-controls',
  imports: [FormsModule, RouterLink],
  templateUrl: './blue-controls.html',
})
export class BlueControls {
  protected readonly prefs = inject(ClientPrefs);
  protected readonly accents = ACCENT_PRESETS;

  /**
   * post/tweet/florp, per the setting this very page sets.
   *
   * The feed-size labels follow it live, so choosing "florps" a few rows above
   * renames "Minimum feed size (20 posts)" while you are looking at it. The
   * radio labels themselves deliberately do not — they name the options.
   */
  protected readonly words = inject(Terminology).words;
}
