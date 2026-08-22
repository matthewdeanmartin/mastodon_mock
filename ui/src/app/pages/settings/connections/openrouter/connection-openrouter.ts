import { Component, inject, OnInit, signal } from '@angular/core';
import { VaultBridge } from '../../../../providers/vault/vault-bridge';

/** The registry base this page's credential is stored under. */
const OPENROUTER_KEY = 'mockingbird_openrouter_key';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OpenRouterSession } from '../../../../providers/openrouter/openrouter-session';
import {
  DEFAULT_MODEL_ID,
  OpenRouterModel,
  OpenRouterModels,
  perMillionTokens,
} from '../../../../providers/openrouter/openrouter-models';
import { OpenRouterModelChoice } from '../../../../providers/openrouter/openrouter-model-choice';
import {
  CreditsState,
  describeCredits,
  OpenRouterCredits,
} from '../../../../providers/openrouter/openrouter-credits';
import {
  PromptTemplateId,
  PromptTemplateStore,
} from '../../../../providers/openrouter/prompt-templates';
import { TranslationPreference } from '../../../../translation-preference';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';
import { expiryLabel } from '../expiry-label';
import { credentialLocation, StorageBadge } from '../storage-badge';
import { PageDiagnostics } from '../../../../page-diagnostics';

/**
 * Settings → Connections → OpenRouter. PKCE connect, model picker, credits.
 *
 * The OAuth round trip lands back here (see `pages/openrouter-callback`), so
 * this page also reads the `?openrouter=` result.
 */
@Component({
  selector: 'app-connection-openrouter',
  imports: [FormsModule, RouterLink, DecimalPipe, StorageBadge],
  templateUrl: './connection-openrouter.html',
  styleUrls: ['../connection-page.css', './connection-openrouter.css'],
})
export class ConnectionOpenRouter implements OnInit {
  private diagnostics = inject(PageDiagnostics);
  protected openrouter = inject(OpenRouterSession);
  protected models = inject(OpenRouterModels);
  protected choice = inject(OpenRouterModelChoice);
  protected prompts = inject(PromptTemplateStore);
  protected translatePref = inject(TranslationPreference);
  private credits = inject(OpenRouterCredits);
  private bridge = inject(VaultBridge);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.browser.detail;
  protected readonly defaultModelId = DEFAULT_MODEL_ID;
  protected readonly expiryLabel = expiryLabel;

  /**
   * Where this key lives, for the badge.
   *
   * Reads the connector's own two facts rather than the vault's state — a
   * locked vault is not a locked credential. See `storage-badge.ts`.
   */
  protected where() {
    return credentialLocation(this.bridge.syncs(OPENROUTER_KEY), this.openrouter.needsFetch());
  }
  protected readonly perMillionTokens = perMillionTokens;
  protected readonly describeCredits = describeCredits;

  protected error = signal<string | null>(null);
  protected notice = signal<string | null>(null);

  protected creditsState = signal<CreditsState | null>(null);
  protected creditsBusy = signal(false);

  /**
   * Draft text per template, so typing doesn't rewrite storage on every
   * keystroke and Cancel is a real option.
   */
  protected drafts = signal<Partial<Record<PromptTemplateId, string>>>({});

  protected query = signal('');
  protected structuredOnly = signal(true);
  protected results = signal<OpenRouterModel[] | null>(null);
  protected searchError = signal<string | null>(null);

  ngOnInit(): void {
    const result = this.route.snapshot.queryParamMap.get('openrouter');
    if (result === 'connected') {
      this.notice.set('OpenRouter connected.');
    } else if (result === 'error') {
      this.error.set(
        this.route.snapshot.queryParamMap.get('message') ?? 'OpenRouter authorization failed.',
      );
    }
    if (result) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }

    // Deep-link case: re-check against a policy shortened on the catalog page.
    this.openrouter.enforceLifetime();

    if (this.openrouter.connected()) {
      void this.refreshCredits();
    }
    // The model list is public, so show the current pick's details either way.
    void this.runSearch();
  }

  async connect(): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.openrouter.connect();
    } catch (error: unknown) {
      this.diagnostics.error('OpenRouter', 'connect:error', error);
      this.error.set(describeError(error, "Couldn't start OpenRouter authorization."));
    }
  }

  disconnect(): void {
    this.openrouter.disconnect();
    this.creditsState.set(null);
    this.notice.set(null);
    this.error.set(null);
  }

  async refreshCredits(): Promise<void> {
    if (this.creditsBusy()) {
      return;
    }
    this.creditsBusy.set(true);
    try {
      this.creditsState.set(await this.credits.load());
    } finally {
      this.creditsBusy.set(false);
    }
  }

  async runSearch(): Promise<void> {
    this.searchError.set(null);
    try {
      this.results.set(
        await this.models.search(this.query(), { structuredOnly: this.structuredOnly() }),
      );
    } catch (error: unknown) {
      this.diagnostics.error('OpenRouter', 'model-search:error', error, {
        queryLength: this.query().length,
      });
      this.results.set(null);
      this.searchError.set(describeError(error, "Couldn't search OpenRouter's models."));
    }
  }

  toggleStructuredOnly(value: boolean): void {
    this.structuredOnly.set(value);
    void this.runSearch();
  }

  choose(model: OpenRouterModel): void {
    this.choice.set(model.id);
  }

  // ------------------------------------------------------------- prompts

  /**
   * A placeholder as the user writes it, braces and all.
   *
   * Built here rather than in the template because Angular decodes `&#123;`
   * back to `{` and then parses the result as an interpolation — there is no
   * way to spell a literal `{{name}}` in a template.
   */
  braced(name: string): string {
    return `{{${name}}}`;
  }

  /** The text in the editor: the unsaved draft if there is one, else the saved text. */
  promptDraft(id: PromptTemplateId): string {
    return this.drafts()[id] ?? this.prompts.text(id);
  }

  editPrompt(id: PromptTemplateId, text: string): void {
    this.drafts.set({ ...this.drafts(), [id]: text });
  }

  promptDirty(id: PromptTemplateId): boolean {
    const draft = this.drafts()[id];
    return draft !== undefined && draft !== this.prompts.text(id);
  }

  savePrompt(id: PromptTemplateId): void {
    this.prompts.set(id, this.promptDraft(id));
    this.clearDraft(id);
  }

  revertPrompt(id: PromptTemplateId): void {
    this.clearDraft(id);
  }

  resetPrompt(id: PromptTemplateId): void {
    this.prompts.reset(id);
    this.clearDraft(id);
  }

  private clearDraft(id: PromptTemplateId): void {
    const next = { ...this.drafts() };
    delete next[id];
    this.drafts.set(next);
  }
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
