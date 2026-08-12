import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../auth';
import { ClientPrefs } from '../../client-prefs';
import { Server } from '../../server';
import { Account } from '../../models';
import { BUNDLED_STARTER_KITS } from '../../bundled-starter-kits.generated';
import { probeServerAvailability } from '../../server-availability';
import { environment } from '../../../environments/environment';
import { brandLogoSrc } from '../../build-flavor';
import { AppFooter } from '../../shell/app-footer/app-footer';

/**
 * Starter kits withheld from the front-page draw.
 *
 * The front page's whole job is an emotional beat — *this is what a good
 * timeline felt like* — and it is the first thing a stranger ever sees. Opening
 * it on war coverage or on one country's partisan politics undercuts that beat
 * regardless of the quality of the accounts involved, and the visitor has not
 * yet opted into any topic. Both kits stay fully available (and unfiltered) at
 * `/bundled-starter-kits`, which someone reaches by choosing to.
 *
 * This is an editorial choice about a landing page, not a judgement about the
 * accounts — which is why it excludes *kits* rather than people. One account
 * belongs to both `canadian-politics` and `retro-computing`, and drawing it as a
 * retro-computing account is entirely fine.
 */
const FRONT_PAGE_KIT_EXCLUSIONS: readonly string[] = ['war-in-ukraine', 'canadian-politics'];

/** How many faces to show. Enough to read as a community, few enough to scan. */
const FACE_COUNT = 12;

/**
 * Servers tried, in order, for "continue without logging in". The picker is
 * deliberately absent from the front door (see sprint/bsky-first-2-front-door),
 * so the page needs its own fallback when the first choice is down.
 */
const ANONYMOUS_SERVERS: readonly string[] = [
  'https://mastodon.social',
  'https://mas.to',
  'https://fosstodon.org',
];

/** Fisher-Yates on a copy. */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The public landing page — the first thing a stranger sees.
 *
 * It shows what the app *is* before asking for anything, which is the whole
 * point: the previous front door was a server combo box and an OAuth scope
 * picker, presented to someone who did not yet know what they were signing into.
 *
 * It paints with **no network call**. The faces come from
 * `bundled-starter-kits.generated.ts`, which is compiled in — so the page is
 * instant, survives every public server being down, and cannot show a spinner
 * where the pitch is supposed to be.
 */
@Component({
  selector: 'app-front',
  imports: [FormsModule, RouterLink, AppFooter],
  templateUrl: './front.html',
  styleUrl: './front.css',
})
export class FrontPage implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);
  private server = inject(Server);
  protected prefs = inject(ClientPrefs);

  protected brand = environment.brand;
  protected logoSrc = computed(() => brandLogoSrc(this.prefs.artStyle()));

  /** Set while a "continue without logging in" click is probing a server. */
  protected entering = signal(false);
  protected enterError = signal<string | null>(null);

  /**
   * The faces, drawn at construction rather than at module scope — a
   * module-level draw is evaluated once per page *load of the bundle*, which in
   * a SPA means the same faces forever.
   */
  protected readonly faces: readonly Account[] = this.drawFaces();

  /** Avatar URLs that failed to load; these fall back to an initial. */
  private brokenAvatars = signal<ReadonlySet<string>>(new Set());

  ngOnInit(): void {
    // A returning visitor must never be shown the pitch again — being handed
    // the marketing page reads as "the app logged me out".
    if (this.auth.isAuthenticated) {
      void this.router.navigateByUrl('/home', { replaceUrl: true });
    }
  }

  /** One account per kit first, so the grid reads as breadth rather than a clique. */
  private drawFaces(): readonly Account[] {
    const kits = shuffled(
      BUNDLED_STARTER_KITS.filter((kit) => !FRONT_PAGE_KIT_EXCLUSIONS.includes(kit.slug)),
    );
    const picked: Account[] = [];
    const leftovers: Account[] = [];
    for (const kit of kits) {
      const accounts = shuffled(kit.accounts).filter((a) => !a.bot);
      if (accounts.length > 0) {
        picked.push(accounts[0]);
        leftovers.push(...accounts.slice(1));
      }
    }
    return [...picked, ...shuffled(leftovers)].slice(0, FACE_COUNT);
  }

  /** Strip the HTML Mastodon bios arrive as, for a one-line plain-text preview. */
  protected bioText(account: Account): string {
    return (account.note ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(#39|apos);/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  protected avatarBroken(account: Account): boolean {
    return this.brokenAvatars().has(account.id);
  }

  /**
   * Avatars are remote URLs on hosts a content blocker may well refuse, so a
   * failure is expected traffic, not an error. Degrade to an initial rather
   * than leaving a grid of broken images under the pitch.
   */
  protected onAvatarError(account: Account): void {
    this.brokenAvatars.update((set) => new Set(set).add(account.id));
  }

  protected initial(account: Account): string {
    const source = account.display_name?.trim() || account.username || '?';
    return [...source][0]?.toUpperCase() ?? '?';
  }

  /**
   * Enter as the browser-local Anonymous account: one click, no questions.
   *
   * The server is auto-picked. If the first choice is unreachable we quietly try
   * the next rather than surfacing a picker — a stranger cannot be expected to
   * have an opinion about which Mastodon server to read.
   */
  async continueWithoutLoggingIn(): Promise<void> {
    if (this.entering()) {
      return;
    }
    this.entering.set(true);
    this.enterError.set(null);
    for (const candidate of ANONYMOUS_SERVERS) {
      const result = await probeServerAvailability(candidate);
      if (result.status !== 'unreachable') {
        // Record which server was actually used, so the notice after entry (and
        // Settings → Server) reflects reality rather than the first choice.
        this.server.setBaseUrl(candidate);
        this.auth.enterAnonymous(candidate);
        this.entering.set(false);
        await this.router.navigateByUrl('/home');
        return;
      }
    }
    this.entering.set(false);
    this.enterError.set(
      'Could not reach a public server just now. Check your connection, or sign in to your own server.',
    );
  }
}
