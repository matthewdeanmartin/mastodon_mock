import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../auth';
import { PageDiagnostics } from '../../page-diagnostics';
import { Server } from '../../server';
import {
  anonymousEntryUrl,
  INVITE_LIMITS,
  InviteContext,
  InviteNetwork,
  InviteVariation,
  inviteIntentUrl,
  invitesFor,
  renderInvite,
} from '../../invites/invite-templates';

/** A variation joined to its rendered (and possibly hand-edited) text. */
interface InviteCard {
  variation: InviteVariation;
  /** Exactly what will be handed to the composer. */
  text: string;
  /** Local estimate; see INVITE_LIMITS for why it is only an estimate. */
  length: number;
  overLimit: boolean;
  /** True once the user has typed in this card's box. */
  edited: boolean;
  intentUrl: string;
}

/**
 * "Invite people": ten prewritten posts for X and eight for Bluesky, each of
 * which opens a prefilled composer on that network.
 *
 * There is no X or Bluesky API here, no OAuth, and no posting. Every card ends
 * at a web intent — a normal link to a composer the user still has to read and
 * submit. Which means this page works from the static GitHub Pages build, and
 * also means we can never know whether a post was actually made. The
 * diagnostics below say "intent opened" and nothing stronger, on purpose.
 *
 * The text in each card is a `<textarea>`, so the preview and the editor are the
 * same object: what you see is byte-for-byte what goes into `?text=`, with no
 * second render step to disagree with it.
 */
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

  protected readonly network = signal<InviteNetwork>('x');
  protected readonly limits = INVITE_LIMITS;

  /**
   * Whether the user *wants* to be named in the invitations that can name them.
   *
   * On by default, and deliberately independent of whether a profile URL is
   * known yet: `Auth.account()` is filled in by a request that has usually not
   * landed when this page initialises, so reading it once at startup to pick a
   * default meant the profile line silently stayed out of every invitation. The
   * effective answer is this AND {@link hasProfile}, recomputed as the account
   * arrives. Off drops those lines whole rather than blanking them — see
   * `renderInvite`.
   */
  protected readonly includeProfile = signal(true);

  /** Hand edits, keyed by variation id. Deliberately not persisted. */
  private readonly edits = signal<Record<string, string>>({});
  /** Display order per network, so Shuffle can rotate a card to the top. */
  private readonly order = signal<Record<InviteNetwork, readonly string[]>>({
    x: invitesFor('x').map((invite) => invite.id),
    bluesky: invitesFor('bluesky').map((invite) => invite.id),
  });

  /** Which card's copy just succeeded / failed, for the inline confirmation. */
  protected readonly copied = signal<string | null>(null);
  protected readonly copyFailed = signal<string | null>(null);
  /** The card whose text is shown in the fallback dialog when copying is denied. */
  protected readonly fallbackText = signal<string | null>(null);

  /** The account's canonical profile URL, or '' when there isn't one. */
  protected readonly profileUrl = computed(() => this.auth.account()?.url ?? '');

  /**
   * `@user@host` for the signed-in account, or '' when there isn't a real one.
   *
   * Gated on the profile URL, which is the only trustworthy sign that this
   * account exists somewhere a stranger can reach. The Anonymous account has a
   * username (its instance's domain) and no profile page at all, and printing
   * `@mastodon.social@mastodon.social` in an invitation would be worse than
   * printing nothing.
   */
  protected readonly handle = computed(() => {
    const account = this.auth.account();
    if (!account?.username || !this.profileUrl()) {
      return '';
    }
    const acct = account.acct ?? '';
    if (acct.includes('@')) {
      return `@${acct}`;
    }
    const host = this.homeHost();
    return host ? `@${account.username}@${host}` : '';
  });

  /**
   * The instance a Bluesky reader should land on. Their friends are wherever
   * *we* are, so prefer the user's own server; mastodon.social is the fallback
   * for an account whose host we cannot determine.
   */
  protected readonly homeHost = computed(() => {
    const acct = this.auth.account()?.acct ?? '';
    const at = acct.indexOf('@');
    if (at > 0) {
      return acct.slice(at + 1);
    }
    return this.server.baseUrl().replace(/^https?:\/\//, '');
  });

  protected readonly visitUrl = computed(() => anonymousEntryUrl(this.homeHost()));

  /** False when nothing personal can be offered, so the toggle explains itself. */
  protected readonly hasProfile = computed(() => !!this.profileUrl());

  /** Whether invitations will actually name the user: wanted, and possible. */
  protected readonly naming = computed(() => this.includeProfile() && this.hasProfile());

  /** What the templates get. Withholding the profile empties both personal tokens. */
  private readonly context = computed<InviteContext>(() => ({
    profileUrl: this.naming() ? this.profileUrl() : '',
    handle: this.naming() ? this.handle() : '',
    visitUrl: this.visitUrl(),
  }));

  protected readonly cards = computed<InviteCard[]>(() => {
    const network = this.network();
    const context = this.context();
    const edits = this.edits();
    const byId = new Map(invitesFor(network).map((invite) => [invite.id, invite]));
    const ids = this.order()[network];
    return ids
      .map((id) => byId.get(id))
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
          intentUrl: inviteIntentUrl(network, text),
        };
      });
  });

  ngOnInit(): void {
    this.diagnostics.info('Invites', 'page:open', {
      anonymous: this.auth.isAnonymous,
      hasProfile: this.hasProfile(),
    });
  }

  protected setNetwork(network: InviteNetwork): void {
    this.network.set(network);
    this.clearCopyState();
  }

  protected toggleProfile(include: boolean): void {
    this.includeProfile.set(include);
    // Edited cards keep the words the user chose; re-rendering them under the
    // new setting would silently throw away typing, which is worse than a card
    // that no longer matches the switch. "Reset" puts any of them back.
    this.clearCopyState();
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

  /**
   * Move a card to the top of its network's list.
   *
   * Cheaper than it sounds and more useful than a random shuffle: the point is
   * "show me a different one first", and rotating the list keeps every card
   * reachable instead of hiding some behind a die roll.
   */
  protected shuffle(): void {
    this.order.update((order) => {
      const ids = order[this.network()];
      if (ids.length < 2) {
        return order;
      }
      return { ...order, [this.network()]: [...ids.slice(1), ids[0]] };
    });
  }

  /**
   * Open the composer. This is a plain anchor in the template — the click is the
   * user's own, so no popup blocker is involved and middle-click still works.
   * All we do here is record that the composer was *opened*.
   */
  protected onIntentOpen(card: InviteCard): void {
    this.diagnostics.info('Invites', 'user:intent-open', {
      network: card.variation.network,
      variationId: card.variation.id,
      includedMastodonProfile: this.mentionsProfile(card.text),
      edited: card.edited,
      overLimit: card.overLimit,
    });
  }

  protected async copy(card: InviteCard): Promise<void> {
    this.diagnostics.info('Invites', 'user:copy', {
      network: card.variation.network,
      variationId: card.variation.id,
    });
    try {
      await navigator.clipboard.writeText(card.text);
      this.copyFailed.set(null);
      this.copied.set(card.variation.id);
    } catch {
      this.copied.set(null);
      this.copyFailed.set(card.variation.id);
      // No clipboard permission is not a dead end: show the text somewhere it
      // can be selected by hand.
      this.fallbackText.set(card.text);
    }
  }

  protected closeFallback(): void {
    this.fallbackText.set(null);
  }

  private clearCopyState(): void {
    this.copied.set(null);
    this.copyFailed.set(null);
  }

  /**
   * Whether this text actually names the user, read off the text rather than off
   * the toggle — an edited card may have kept the line after the switch went off,
   * or had it pasted back in by hand.
   */
  private mentionsProfile(text: string): boolean {
    const url = this.profileUrl();
    const handle = this.handle();
    return (!!url && text.includes(url)) || (!!handle && text.includes(handle));
  }

  /** Accessible label, e.g. `Post “Friendly migration” on X`. */
  protected postLabel(card: InviteCard): string {
    return `Post “${card.variation.title}” on ${card.variation.network === 'x' ? 'X' : 'Bluesky'}`;
  }
}
