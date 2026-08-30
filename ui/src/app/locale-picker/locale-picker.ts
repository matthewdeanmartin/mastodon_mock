/**
 * The interface-language control.
 *
 * Lives in the footer for now — the app's chrome is crowded and the footer is
 * the one place with room that appears on every route. It is deliberately a
 * plain `<select>` rather than a styled menu: this is a control people use once
 * and then never again, and a native select is the version that works with
 * every screen reader, every mobile keyboard, and 60 options without scrolling
 * problems.
 *
 * Two rules worth knowing before changing anything here:
 *
 * **Language names are never translated.** Each option is labelled with its own
 * endonym — `Deutsch`, not `German`. Someone who has landed in a language they
 * cannot read must still be able to find their own, and "German" helps nobody
 * who only reads German. Every real language picker on the web works this way.
 *
 * **"Automatic" is not decoration.** Without a way back to browser negotiation,
 * forcing a language once would be irreversible — a trap for anyone reviewing
 * translations far more than for an ordinary reader.
 *
 * The control hides itself entirely while only one locale ships, so it does not
 * clutter the footer with a menu that cannot change anything. It appears on its
 * own when `SUPPORTED_LOCALES` grows.
 */

import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LOCALE_ENDONYMS, SupportedLocale, UiLocale } from '../i18n/locale';

/** The value the `<select>` uses for "let the browser decide". */
const AUTO = 'auto';

/** English source strings; see scripts/extract-i18n.mjs. */
// i18n localePicker.label: Interface language
// i18n localePicker.auto: Automatic (browser)
@Component({
  selector: 'app-locale-picker',
  imports: [TranslocoPipe],
  template: `
    @if (locale.hasChoice) {
      <!-- The separator lives inside the guard so a hidden picker does not
           leave a stray "·" dangling in the footer's link row. -->
      <span class="footer-separator" aria-hidden="true">·</span>
      <label class="locale-picker">
        <span class="sr-only">{{ 'localePicker.label' | transloco }}</span>
        <select
          [value]="current()"
          (change)="pick($event)"
          [attr.aria-label]="'localePicker.label' | transloco"
        >
          <option value="auto">{{ 'localePicker.auto' | transloco }}</option>
          @for (option of options; track option.code) {
            <option [value]="option.code">{{ option.name }}</option>
          }
        </select>
      </label>
    }
  `,
  styles: `
    /* Matches .footer-separator in app-footer, which is style-encapsulated to
       that component and so does not reach this one. */
    .footer-separator {
      display: inline-block;
      margin: 0 0.55em;
    }
    .locale-picker select {
      font: inherit;
      font-size: 12px;
      color: var(--muted);
      background: none;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 4px;
      cursor: pointer;
    }
    .locale-picker select:hover {
      color: var(--accent);
    }
  `,
})
export class LocalePicker {
  protected locale = inject(UiLocale);

  /** Every shipped locale, labelled in its own language. */
  protected readonly options = this.locale.available.map((code) => ({
    code,
    name: LOCALE_ENDONYMS[code] ?? code,
  }));

  /**
   * The selected option: `auto` while the browser is deciding, otherwise the
   * forced locale. Note this is *not* the active locale — under `auto` the UI
   * may be German while the control correctly reads "Automatic".
   */
  protected current = computed(() => (this.locale.isAutomatic() ? AUTO : this.locale.active()));

  protected pick(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.locale.choose(value === AUTO ? null : (value as SupportedLocale));
  }
}
