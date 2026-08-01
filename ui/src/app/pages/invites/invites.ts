import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../auth';
import {
  campaignTaggedUrl,
  InviteContext,
  InviteVariation,
  inviteIntentUrl,
  invitesFor,
  JOIN_MASTODON_URL,
  mastodonRallyText,
  publicServerUrl,
  renderInvite,
} from '../../invites/invite-templates';
import { PageDiagnostics } from '../../page-diagnostics';
import { ShortenerRegistry } from '../../providers/shortener/shortener-registry';
import { ShortenerSettings } from '../../providers/shortener/shortener-settings';
import { Server } from '../../server';

type InviteMode = 'simple' | 'advanced';
type PromotionTarget = 'join-mastodon' | 'home-server';

interface InviteCard {
  variation: InviteVariation;
  text: string;
  length: number;
  overLimit: boolean;
  edited: boolean;
  xIntentUrl: string;
  blueskyIntentUrl: string;
}

/** Public invitation builder. Share intents open composers but never post automatically. */
@Component({
  selector: 'app-invites',
  imports: [RouterLink],
  templateUrl: './invites.html',
  styleUrl: './invites.css',
})
export class Invites implements OnInit {
  private readonly auth = inject(Auth);
  private readonly server = inject(Server);
  private readonly diagnostics = inject(PageDiagnostics);
  private readonly shorteners = inject(ShortenerRegistry);
  private readonly shortenerSettings = inject(ShortenerSettings);

  /** Anonymous mode is usable here, but only a real Mastodon account can add a profile. */
  protected readonly signedIn = this.auth.isAuthenticated && !this.auth.isAnonymous;
  protected readonly mode = signal<InviteMode>('simple');
  protected readonly promotion = signal<PromotionTarget>('join-mastodon');
  protected readonly includeProfile = signal(true);
  protected readonly includeDestination = signal(true);
  private readonly edits = signal<Record<string, string>>({});

  protected readonly copied = signal<string | null>(null);
  protected readonly copyFailed = signal<string | null>(null);
  protected readonly fallbackText = signal<string | null>(null);

  protected readonly profileUrl = computed(() => this.auth.account()?.url ?? '');
  protected readonly hasProfile = computed(() => !!this.profileUrl());
  protected readonly naming = computed(() => this.includeProfile() && this.hasProfile());

  protected readonly homeHost = computed(() => {
    const account = this.auth.account();
    const acct = account?.acct ?? '';
    const at = acct.indexOf('@');
    if (at > 0) {
      return acct.slice(at + 1);
    }
    return (
      this.server
        .baseUrl()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '') || 'mastodon.social'
    );
  });

  protected readonly handle = computed(() => {
    const account = this.auth.account();
    if (!account?.username || !this.profileUrl()) {
      return '';
    }
    return account.acct?.includes('@')
      ? `@${account.acct}`
      : `@${account.username}@${this.homeHost()}`;
  });

  private readonly plainDestinationUrl = computed(() =>
    this.promotion() === 'home-server' ? publicServerUrl(this.homeHost()) : JOIN_MASTODON_URL,
  );

  protected readonly shorten = signal(false);
  protected readonly trackCampaign = signal(false);
  private readonly shortDestinationUrl = signal<string | null>(null);
  protected readonly shortening = signal(false);
  protected readonly shortenError = signal<string | null>(null);
  protected readonly shortenerReady = computed(() => this.shortenerSettings.usable());
  protected readonly shortenerLabel = computed(
    () => this.shortenerSettings.chosen()?.label ?? 'a link shortener',
  );
  protected readonly destinationUrl = computed(
    () => this.shortDestinationUrl() ?? this.plainDestinationUrl(),
  );

  private readonly context = computed<InviteContext>(() => ({
    profileUrl: this.naming() ? this.profileUrl() : '',
    handle: this.naming() ? this.handle() : '',
    visitUrl: this.includeDestination() ? this.destinationUrl() : '',
  }));

  protected readonly cards = computed<InviteCard[]>(() => {
    const context = this.context();
    const edits = this.edits();
    return invitesFor(this.mode() === 'simple').map((variation) => {
      const edit = edits[variation.id];
      const text = edit ?? renderInvite(variation.template, context);
      const length = Array.from(text).length;
      return {
        variation,
        text,
        length,
        overLimit: length > 280,
        edited: edit !== undefined,
        xIntentUrl: inviteIntentUrl('x', text),
        blueskyIntentUrl: inviteIntentUrl('bluesky', text),
      };
    });
  });

  protected readonly rallyText = mastodonRallyText();
  protected readonly mastodonRallyIntent = computed(() =>
    inviteIntentUrl('mastodon', this.rallyText, this.homeHost()),
  );

  ngOnInit(): void {
    this.diagnostics.info('Invites', 'page:open', {
      signedIn: this.signedIn,
      hasProfile: this.hasProfile(),
      server: this.homeHost(),
    });
  }

  protected setMode(mode: InviteMode): void {
    this.mode.set(mode);
    this.clearCopyState();
    if (mode === 'simple') {
      this.promotion.set('join-mastodon');
      this.includeDestination.set(true);
      this.includeProfile.set(true);
      this.shorten.set(false);
      this.trackCampaign.set(false);
      this.shortDestinationUrl.set(null);
    }
  }

  protected setPromotion(target: PromotionTarget): void {
    this.promotion.set(target);
    this.shortDestinationUrl.set(null);
    if (this.shorten()) {
      void this.makeShortLink();
    }
  }

  protected toggleProfile(include: boolean): void {
    this.includeProfile.set(include);
    this.clearCopyState();
  }

  protected toggleDestination(include: boolean): void {
    this.includeDestination.set(include);
    this.clearCopyState();
  }

  protected async toggleShorten(on: boolean): Promise<void> {
    this.shorten.set(on);
    this.shortenError.set(null);
    if (!on) {
      this.shortDestinationUrl.set(null);
      return;
    }
    await this.makeShortLink();
  }

  protected async toggleTracking(on: boolean): Promise<void> {
    this.trackCampaign.set(on);
    this.shortenError.set(null);
    if (this.shorten()) {
      await this.makeShortLink();
    }
  }

  private async makeShortLink(): Promise<void> {
    if (!this.shortenerReady()) {
      this.shorten.set(false);
      return;
    }
    const firstId = this.cards()[0]?.variation.id ?? 'invite';
    const target = this.trackCampaign()
      ? campaignTaggedUrl(this.plainDestinationUrl(), {
          source: 'mawkingbird',
          variationId: firstId,
        })
      : this.plainDestinationUrl();

    this.shortening.set(true);
    try {
      const link = await firstValueFrom(this.shorteners.create({ destinationUrl: target }));
      this.shortDestinationUrl.set(link.shortUrl);
      this.diagnostics.info('Invites', 'link:shortened', {
        provider: link.provider,
        tracked: this.trackCampaign(),
      });
    } catch (error: unknown) {
      this.shortDestinationUrl.set(null);
      this.shorten.set(false);
      this.shortenError.set(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't shorten the link. The invitations still work with the full URL.",
      );
    } finally {
      this.shortening.set(false);
    }
  }

  protected onEdit(id: string, text: string): void {
    this.edits.update((edits) => ({ ...edits, [id]: text }));
    this.clearCopyState();
  }

  protected reset(id: string): void {
    this.edits.update((edits) => {
      const next = { ...edits };
      delete next[id];
      return next;
    });
    this.clearCopyState();
  }

  protected onIntentOpen(card: InviteCard, network: 'x' | 'bluesky'): void {
    this.diagnostics.info('Invites', 'user:intent-open', {
      network,
      variationId: card.variation.id,
      includedMastodonProfile: this.mentionsProfile(card.text),
      edited: card.edited,
      overLimit: card.overLimit,
    });
  }

  protected onRallyOpen(): void {
    this.diagnostics.info('Invites', 'user:rally-intent-open', { server: this.homeHost() });
  }

  protected async copy(card: InviteCard): Promise<void> {
    try {
      await navigator.clipboard.writeText(card.text);
      this.copyFailed.set(null);
      this.copied.set(card.variation.id);
    } catch {
      this.copied.set(null);
      this.copyFailed.set(card.variation.id);
      this.fallbackText.set(card.text);
    }
  }

  protected closeFallback(): void {
    this.fallbackText.set(null);
  }

  protected postLabel(card: InviteCard, network: 'Twitter' | 'Bluesky'): string {
    return `Post “${card.variation.title}” on ${network}`;
  }

  private clearCopyState(): void {
    this.copied.set(null);
    this.copyFailed.set(null);
  }

  private mentionsProfile(text: string): boolean {
    return (
      (!!this.profileUrl() && text.includes(this.profileUrl())) ||
      (!!this.handle() && text.includes(this.handle()))
    );
  }
}
