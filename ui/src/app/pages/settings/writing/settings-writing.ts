import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { ClientPrefs } from '../../../client-prefs';
import { POSTING_LANGUAGE_OPTIONS } from '../../../language-detect';
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
 * Writing settings: everything about getting words out — where writing starts,
 * what gets asked at the moment you publish, and the drafts/notes workflow.
 *
 * Absorbed the old "Posting & Privacy" page's posting defaults, which were the
 * same subject reached from the other side. Those rows still appear on Privacy
 * too, deliberately: "what visibility do I publish at" and "who can see me" are
 * one setting seen through two different questions, and making the user guess
 * which category we filed it under is worse than showing it twice. Both pages
 * write the same credentials, so whichever one they find is the right one.
 *
 * Mixed client- and server-side as a result: the vocabulary, wizard and Home
 * composer prefs are localStorage and work anonymously, while posting defaults
 * need a server and hide themselves when there isn't one.
 */
@Component({
  selector: 'app-settings-writing',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-writing.html',
})
export class SettingsWriting implements OnInit {
  protected prefs = inject(ClientPrefs);
  private api = inject(Api);
  protected auth = inject(Auth);

  // ---- server-backed posting defaults (also shown on the Privacy page) ----
  protected privacy = signal('public');
  protected sensitive = signal(false);
  protected language = signal('');
  protected readonly postingLanguageOptions = POSTING_LANGUAGE_OPTIONS;
  protected postingSaving = signal(false);
  protected postingSaved = signal(false);

  ngOnInit(): void {
    if (this.auth.isAnonymous) {
      return;
    }
    this.api.verifyCredentials().subscribe((acc) => {
      this.privacy.set(acc.source?.privacy ?? 'public');
      this.sensitive.set(acc.source?.sensitive ?? false);
      this.language.set(acc.source?.language ?? '');
    });
  }

  /**
   * Save only the posting fields.
   *
   * Deliberately does not send `locked`/`discoverable`/`bot`: this page never
   * loaded them, and a FormData update writes whatever it names. Sending them
   * from stale defaults would silently unlock an account whose owner came here
   * to change their default language.
   */
  protected savePosting(): void {
    if (this.postingSaving()) {
      return;
    }
    this.postingSaving.set(true);
    this.postingSaved.set(false);

    const form = new FormData();
    form.append('source[privacy]', this.privacy());
    form.append('source[sensitive]', String(this.sensitive()));
    form.append('source[language]', this.language().trim());

    this.api.updateCredentials(form).subscribe({
      next: () => {
        this.postingSaving.set(false);
        this.postingSaved.set(true);
        this.prefs.setDefaultVisibility(this.privacy());
        if (this.language()) this.prefs.addKnownLanguage(this.language());
      },
      error: () => this.postingSaving.set(false),
    });
  }

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
