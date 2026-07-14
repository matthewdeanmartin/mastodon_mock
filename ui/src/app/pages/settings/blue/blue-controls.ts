import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ACCENT_PRESETS, ClientPrefs } from '../../../client-prefs';

/**
 * The Mockingbird Blue control cluster: theme, accent, undo-send and reader
 * typography. All settings live in localStorage (ClientPrefs) and apply
 * instantly. Shared by the "Mockingbird Blue" settings page and Appearance,
 * so the same controls are findable in both places.
 */
@Component({
  selector: 'app-blue-controls',
  imports: [FormsModule],
  templateUrl: './blue-controls.html',
})
export class BlueControls {
  protected readonly prefs = inject(ClientPrefs);
  protected readonly accents = ACCENT_PRESETS;
}
