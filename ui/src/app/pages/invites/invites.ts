import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../auth';
import {
  campaignTaggedUrl,
  INVITE_LIMITS,
  InviteContext,
  InviteNetwork,
  InviteVariation,
  inviteIntentUrl,
  invitesFor,
  invitesPageUrl,
  JOIN_MASTODON_URL,
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
  intentUrl: string;
}

/** Invitation builder rendered inside Mawkingbird's standard three-column shell. */
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

  protected readonly signedIn = this.auth.isAuthenticated && !this.auth.isAnonymous;
  protected readonly mode = signal<InviteMode>('simple');
  protected readonly network = signal<InviteNetwork>('x');
  protected readonly promotion = signal<PromotionTarget>('join-mastodon');
  protected readonly includeProfile = signal(true);
  protected readonly includeLink = signal(true);
  protected readonly limits = INVITE_LIMITS;
  private readonly edits = signal<Record<string, string>>({});
  /** Display order per platform; Shuffle rotates the visible deck instead of randomizing it. */
  private readonly order = signal<Record<InviteNetwork, readonly string[]>>({
    x: invitesFor('x', false).map((invite) => invite.id),
    bluesky: invitesFor('bluesky', false).map((invite) => invite.id),
    mastodon: invitesFor('mastodon', false).map((invite) => invite.id),
  });

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

  private readonly plainLinkUrl = computed(() => {
    if (this.network() === 'mastodon') {
      return invitesPageUrl(this.homeHost());
    }
    return this.promotion() === 'home-server'
      ? publicServerUrl(this.homeHost())
      : JOIN_MASTODON_URL;
  });

  protected readonly shorten = signal(false);
  protected readonly trackCampaign = signal(false);
  private readonly shortLinkUrl = signal<string | null>(null);
  protected readonly shortening = signal(false);
  protected readonly shortenError = signal<string | null>(null);
  protected readonly shortenerReady = computed(() => this.shortenerSettings.usable());
  protected readonly shortenerLabel = computed(
    () => this.shortenerSettings.chosen()?.label ?? 'a link shortener',
  );
  protected readonly linkUrl = computed(() => this.shortLinkUrl() ?? this.plainLinkUrl());

  private readonly context = computed<InviteContext>(() => ({
    profileUrl: this.naming() ? this.profileUrl() : '',
    handle: this.naming() ? this.handle() : '',
    visitUrl: this.network() !== 'mastodon' && this.includeLink() ? this.linkUrl() : '',
    inviteUrl: this.network() === 'mastodon' && this.includeLink() ? this.linkUrl() : '',
  }));

  protected readonly cards = computed<InviteCard[]>(() => {
    const network = this.network();
    const context = this.context();
    const edits = this.edits();
    const available = new Map(
      invitesFor(network, this.mode() === 'simple').map((invite) => [invite.id, invite]),
    );
    return this.order()
      [network].map((id) => available.get(id))
      .filter((variation): variation is InviteVariation => !!variation)
      .map((variation) => {
        const edit = edits[variation.id];
        const text = edit ?? renderInvite(variation.template, context);
        const length = Array.from(text).length;
        return {
          variation,
          text,
          length,
          overLimit: length > INVITE_LIMITS[network],
          edited: edit !== undefined,
          intentUrl: inviteIntentUrl(network, text, this.homeHost()),
        };
      });
  });

  ngOnInit(): void {
    this.diagnostics.info('Invites', 'page:open', {
      anonymous: this.auth.isAnonymous,
      hasProfile: this.hasProfile(),
      server: this.homeHost(),
    });
  }

  protected setMode(mode: InviteMode): void {
    this.mode.set(mode);
    this.clearCopyState();
    if (mode === 'simple') {
      this.promotion.set('join-mastodon');
      this.includeLink.set(true);
      this.includeProfile.set(true);
      this.shorten.set(false);
      this.trackCampaign.set(false);
      this.shortLinkUrl.set(null);
    }
  }

  protected setNetwork(network: InviteNetwork): void {
    this.network.set(network);
    this.shorten.set(false);
    this.trackCampaign.set(false);
    this.shortLinkUrl.set(null);
    this.clearCopyState();
  }

  protected setPromotion(target: PromotionTarget): void {
    this.promotion.set(target);
    this.shortLinkUrl.set(null);
    if (this.shorten()) {
      void this.makeShortLink();
    }
  }

  protected toggleProfile(include: boolean): void {
    this.includeProfile.set(include);
    this.clearCopyState();
  }

  protected toggleLink(include: boolean): void {
    this.includeLink.set(include);
    if (!include) {
      this.shorten.set(false);
      this.shortLinkUrl.set(null);
    }
    this.clearCopyState();
  }

  protected async toggleShorten(on: boolean): Promise<void> {
    this.shorten.set(on);
    this.shortenError.set(null);
    if (!on) {
      this.shortLinkUrl.set(null);
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
      ? campaignTaggedUrl(this.plainLinkUrl(), {
          source: this.network(),
          variationId: firstId,
        })
      : this.plainLinkUrl();

    this.shortening.set(true);
    try {
      const link = await firstValueFrom(this.shorteners.create({ destinationUrl: target }));
      this.shortLinkUrl.set(link.shortUrl);
      this.diagnostics.info('Invites', 'link:shortened', {
        provider: link.provider,
        tracked: this.trackCampaign(),
      });
    } catch (error: unknown) {
      this.shortLinkUrl.set(null);
      this.shorten.set(false);
      this.shortenError.set(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't shorten the link. The invitation still works with the full URL.",
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

  /** Show the next visible message first while keeping every message reachable. */
  protected shuffle(): void {
    const network = this.network();
    const visibleIds = this.cards().map((card) => card.variation.id);
    if (visibleIds.length < 2) {
      return;
    }
    const rotated = [...visibleIds.slice(1), visibleIds[0]];
    const visible = new Set(visibleIds);
    this.order.update((order) => ({
      ...order,
      [network]: [...rotated, ...order[network].filter((id) => !visible.has(id))],
    }));
    this.clearCopyState();
  }

  protected onIntentOpen(card: InviteCard): void {
    this.diagnostics.info('Invites', 'user:intent-open', {
      network: this.network(),
      variationId: card.variation.id,
      edited: card.edited,
      overLimit: card.overLimit,
    });
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

  protected networkLabel(): string {
    return this.network() === 'x'
      ? 'Twitter'
      : this.network() === 'bluesky'
        ? 'Bluesky'
        : 'Mastodon';
  }

  protected actionLabel(card: InviteCard): string {
    const verb =
      this.network() === 'mastodon' ? 'Rally Mastodon with' : `Post on ${this.networkLabel()}:`;
    return `${verb} “${card.variation.title}”`;
  }

  private clearCopyState(): void {
    this.copied.set(null);
    this.copyFailed.set(null);
  }
}
