import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClientPrefs } from '../../../client-prefs';
import {
  DEFAULT_PKM_VOCABULARY,
  PKM_KINDS,
  PkmKind,
  formatVocabularyField,
  parseVocabularyField,
  pkmNoun,
} from '../../../pkm/pkm-tags';
import { WIZARD_STEPS, WizardStep, activeSteps, stepTitle } from '../../../publish-wizard';

/**
 * Writing settings: the words that mark a post as a note, a to-do or a calendar
 * item.
 *
 * A settings page of its own rather than a row in the Blue/Appearance control
 * cluster, which is a column of switches — this is three text fields plus an
 * explanation, and it needs the room. It is anonymous-capable because the whole
 * PKM feature is: a note can be a browser-local draft, and that path needs no
 * server at all.
 */
@Component({
  selector: 'app-settings-writing',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-writing.html',
})
export class SettingsWriting {
  protected prefs = inject(ClientPrefs);

  protected readonly kinds = PKM_KINDS;
  protected readonly noun = pkmNoun;
  protected saved = signal(false);

  protected readonly wizardSteps = WIZARD_STEPS;
  protected readonly stepTitle = stepTitle;

  /** True when every step is off, so Publish goes straight through. */
  protected wizardOff = computed(() => activeSteps(this.prefs.wizardSteps()).length === 0);

  protected stepOn(step: WizardStep): boolean {
    return this.prefs.wizardSteps()[step];
  }

  protected toggleStep(step: WizardStep, on: boolean): void {
    this.prefs.setWizardStep(step, on);
  }

  /**
   * The editable text of each field, seeded from the stored vocabulary.
   *
   * Held separately from the pref so a half-typed `todo, auf` isn't normalized
   * out from under the cursor on every keystroke. Committed on save.
   */
  protected fields = signal<Record<PkmKind, string>>(this.currentFields());

  /** Which kinds are currently switched off, for the warning under the fields. */
  protected disabledKinds = computed(() =>
    this.kinds.filter((kind) => parseVocabularyField(this.fields()[kind]).length === 0),
  );

  protected defaultsFor(kind: PkmKind): string {
    return formatVocabularyField(DEFAULT_PKM_VOCABULARY[kind]);
  }

  protected setField(kind: PkmKind, value: string): void {
    this.fields.update((fields) => ({ ...fields, [kind]: value }));
    this.saved.set(false);
  }

  protected save(): void {
    const fields = this.fields();
    this.prefs.setPkmVocabulary({
      note: parseVocabularyField(fields.note),
      todo: parseVocabularyField(fields.todo),
      cal: parseVocabularyField(fields.cal),
    });
    // Re-seed from what was actually stored, so the boxes show the normalized
    // words rather than whatever was typed.
    this.fields.set(this.currentFields());
    this.saved.set(true);
  }

  protected reset(): void {
    this.prefs.resetPkmVocabulary();
    this.fields.set(this.currentFields());
    this.saved.set(true);
  }

  protected toggleWarn(on: boolean): void {
    this.prefs.warnOnPkmPublish.set(on);
  }

  private currentFields(): Record<PkmKind, string> {
    const vocab = this.prefs.pkmVocabulary();
    return {
      note: formatVocabularyField(vocab.note),
      todo: formatVocabularyField(vocab.todo),
      cal: formatVocabularyField(vocab.cal),
    };
  }
}
