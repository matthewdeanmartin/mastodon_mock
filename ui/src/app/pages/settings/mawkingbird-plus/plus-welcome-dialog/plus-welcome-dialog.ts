import { Component, computed, inject, output, signal } from '@angular/core';
import { CorsProxySettings } from '../../../../providers/cors-proxy/cors-proxy-settings';
import {
  PLANNED_FEATURES,
  PLUS_FEATURES,
  PlusFeatures,
} from '../../../../providers/account/plus-features';
import type { PlannedFeature, PlusFeature } from '../../../../providers/account/plus-features';
import { VAULT_TEST_ROLLOUT } from '../../../../providers/vault/vault-preference';

/**
 * The one-time "what do you want switched on?" dialog.
 *
 * ## Why it cannot be dismissed
 *
 * No close button, no backdrop click, no Escape. The only way out is **Save**,
 * which is what makes this a click-wrap: the user has seen the list and pressed
 * a button, whatever the toggles said when they did.
 *
 * That is a deliberate exception to how every other dialog in this app behaves,
 * and it is why the dialog asks for so little. It is shown once per account, it
 * has a working default for every row, and pressing Save without touching
 * anything is a complete and reasonable answer. A blocking dialog that also
 * demanded thought would be a bad trade; this one only demands a click.
 *
 * There is no "skip" or "cancel" because those are not answers — they would
 * leave the account in the same undecided state that caused the dialog to
 * appear, so it would come back, and a dialog that reappears after you dismiss
 * it is worse than one that cannot be dismissed at all.
 *
 * ## Why everything starts on
 *
 * Someone who paid for Plus and then finds none of it running has been given a
 * worse experience than a free user, for money. Subscribing is itself an
 * indication of what they want; the dialog exists so that the choice is
 * *theirs*, not so that the default has to be "off".
 *
 * ## Why the unavailable features are shown at all
 *
 * API key sync is active on the test deployment and remains a visible planned
 * row elsewhere. Chat remains planned everywhere.
 */
@Component({
  selector: 'app-plus-welcome-dialog',
  templateUrl: './plus-welcome-dialog.html',
  styleUrl: './plus-welcome-dialog.css',
})
export class PlusWelcomeDialog {
  private features = inject(PlusFeatures);
  private proxy = inject(CorsProxySettings);
  private vaultRollout = inject(VAULT_TEST_ROLLOUT);

  /** Emitted once the answer is saved and the dialog should come down. */
  readonly saved = output<void>();

  protected readonly activeFeatures = PLUS_FEATURES.filter(
    (feature) => feature !== 'apiKeys' || this.vaultRollout,
  );
  protected readonly planned = PLANNED_FEATURES.filter(
    (feature) => feature !== 'apiKeys' || !this.vaultRollout,
  );

  /**
   * The pending answer, held locally until Save.
   *
   * Not written through on each toggle: the dialog is one decision with several
   * parts, and a half-answered record left behind by a closed tab would be
   * neither the user's choice nor the default.
   */
  protected readonly choices = signal<Record<PlusFeature, boolean>>(
    Object.fromEntries(
      PLUS_FEATURES.map((feature) => [feature, this.features.isOn(feature)]),
    ) as Record<PlusFeature, boolean>,
  );

  protected readonly rows = computed(() =>
    this.activeFeatures.map((feature) => ({
      feature,
      on: this.choices()[feature],
      label: LABELS[feature],
      detail: DETAILS[feature],
    })),
  );

  protected readonly plannedRows = computed(() =>
    this.planned.map((feature) => ({
      feature,
      label: PLANNED_LABELS[feature],
      detail: PLANNED_DETAILS[feature],
    })),
  );

  protected toggle(feature: PlusFeature, on: boolean): void {
    this.choices.set({ ...this.choices(), [feature]: on });
  }

  protected label(feature: PlannedFeature): string {
    return PLANNED_LABELS[feature];
  }

  /**
   * Save, and come down.
   *
   * Always closes, even if the side effects fail. The alternative is a
   * non-dismissible dialog that a network problem can weld shut — locking
   * someone out of the app over a preference. The choices are recorded locally
   * either way, and the features that need the network reconcile later.
   */
  protected save(): void {
    const choices = this.choices();
    this.features.save(choices);
    if (choices.corsProxy) {
      // Only when this browser has no working proxy — a deliberate, working
      // choice of another vendor is never overridden. See
      // `CorsProxySettings.adoptSupporterProxy`.
      if (this.proxy.missingEntitledProxy()) {
        this.proxy.adoptSupporterProxy();
      }
    }
    this.saved.emit();
  }
}

const LABELS: Record<PlusFeature, string> = {
  corsProxy: 'Mawkingbird CORS proxy',
  trustSync: 'Trusted accounts',
  listsSync: 'Client lists',
  feedsSync: 'RSS subscription list',
  apiKeys: 'Encrypted connection keys',
};

const DETAILS: Record<PlusFeature, string> = {
  corsProxy: 'Fetch feeds and pages that block browsers directly. Uses your Plus rate limit.',
  trustSync: 'Who you trust, kept per Mastodon account.',
  listsSync: 'Your lists, stored on your account instead of only in this browser.',
  feedsSync: 'The list of feeds you subscribe to — not the articles themselves.',
  apiKeys: 'Keep low-churn connector credentials encrypted and available on your other devices.',
};

const PLANNED_LABELS: Record<PlannedFeature, string> = {
  apiKeys: 'API key sync',
  chat: 'End-to-end encrypted chat',
};

const PLANNED_DETAILS: Record<PlannedFeature, string> = {
  apiKeys: 'Being exercised on the test deployment before it is offered here.',
  chat: 'Not yet.',
};
