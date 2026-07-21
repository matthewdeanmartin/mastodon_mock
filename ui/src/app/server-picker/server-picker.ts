import {
  Component,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MastodonServers, ServerSuggestion } from '../mastodon-servers';
import { normalizeHostUrl } from '../host-url';

/**
 * Something that could plausibly be an instance host (with or without scheme): a
 * dotted domain, or a local dev target (localhost / *.localhost / bare IP), each
 * optionally :port. Mirrors login's DOMAIN_RE.
 */
const DOMAIN_RE =
  /^(https?:\/\/)?(([a-z0-9-]+\.)+[a-z]{2,}|localhost|([a-z0-9-]+\.)*localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/i;

/** How the current combo text relates to a reachable instance. */
export type ServerStatus = 'idle' | 'checking' | 'ok' | 'unreachable';

/**
 * The instance-picker combo box: a text field with joinmastodon-backed
 * autocomplete and a live reachability probe, extracted so the fail-whale can
 * offer the same "change your server" affordance the login page does.
 *
 * It is deliberately self-contained and side-effect free: it probes a typed or
 * chosen instance's `/api/v1/instance`, and on a reachable one emits `picked`
 * with the normalized base URL. The parent decides what changing servers means
 * (log in there, move the anonymous identity, clear the fail whale, …) — this
 * component never touches Server, Auth, or storage.
 *
 * NOTE: the combo logic here is intentionally parallel to `Login`'s own copy.
 * Login predates this component and has its own probe wired into its OAuth flow;
 * unifying them is a larger refactor deferred for now.
 */
@Component({
  selector: 'app-server-picker',
  imports: [FormsModule],
  templateUrl: './server-picker.html',
  styleUrl: './server-picker.css',
})
export class ServerPicker implements OnInit, OnDestroy {
  private mastodonServers = inject(MastodonServers);
  private destroyRef = inject(DestroyRef);

  /** Emitted with a normalized base URL once a reachable instance is chosen. */
  readonly picked = output<string>();

  protected customServer = signal('');
  /** Curated instances matching the combo text; drives the suggestion dropdown. */
  protected serverSuggestions = signal<ServerSuggestion[]>([]);
  /** Whether the suggestion dropdown is open (focused + has results). */
  protected suggestOpen = signal(false);
  /** Reachability of what's typed in the combo (drives the ✓/⚠ hint). */
  protected serverStatus = signal<ServerStatus>('idle');
  /** The reached instance's self-reported title ("Mastodon", …). */
  protected serverTitle = signal<string | null>(null);

  private serverDebounce: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a slow instance probe overwriting a newer one. */
  private probeSeq = 0;

  ngOnInit(): void {
    // Warm the curated joinmastodon index (cached; weekly refresh) so the picker
    // can suggest real, described instances the moment the field is focused.
    this.mastodonServers.ensureLoaded();
  }

  ngOnDestroy(): void {
    if (this.serverDebounce) {
      clearTimeout(this.serverDebounce);
    }
  }

  /** As soon as the text looks like a domain, probe it and (on success) emit. */
  onServerInput(value: string): void {
    this.customServer.set(value);
    this.serverStatus.set('idle');
    this.serverTitle.set(null);
    this.refreshSuggestions(value);
    if (this.serverDebounce) {
      clearTimeout(this.serverDebounce);
    }
    if (!DOMAIN_RE.test(value.trim())) {
      return;
    }
    this.serverDebounce = setTimeout(() => void this.probeAndApply(value), 500);
  }

  /** Recompute the curated-instance suggestions for the current combo text. */
  private refreshSuggestions(value: string): void {
    const matches = this.mastodonServers.search(value);
    // Don't show a one-item list that just echoes an exact domain already typed.
    const echo = matches.length === 1 && matches[0].domain === value.trim().toLowerCase();
    this.serverSuggestions.set(echo ? [] : matches);
  }

  onServerFocus(): void {
    this.refreshSuggestions(this.customServer());
    this.suggestOpen.set(true);
  }

  onServerBlur(): void {
    // Delay so a click on an option can register before the list closes.
    setTimeout(() => this.suggestOpen.set(false), 150);
  }

  chooseSuggestion(s: ServerSuggestion): void {
    this.customServer.set(s.domain);
    this.serverSuggestions.set([]);
    this.suggestOpen.set(false);
    void this.probeAndApply(s.domain);
  }

  /** A rough "big / mid / cozy" size label for a suggestion row. */
  sizeLabel(users: number): string {
    if (users >= 100_000) return 'very large';
    if (users >= 10_000) return 'large';
    if (users >= 1_000) return 'mid-size';
    if (users > 0) return 'cozy';
    return '';
  }

  /** Enter in the combo: don't wait for the debounce. */
  applyServerNow(): void {
    if (this.serverDebounce) {
      clearTimeout(this.serverDebounce);
    }
    void this.probeAndApply(this.customServer());
  }

  private async probeAndApply(value: string): Promise<void> {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!DOMAIN_RE.test(trimmed)) {
      return;
    }
    // Quietly supply the scheme: https for real hosts, http for localhost / IPs.
    const base = normalizeHostUrl(trimmed);
    const seq = ++this.probeSeq;
    this.suggestOpen.set(false);
    this.serverStatus.set('checking');
    try {
      const res = await fetch(`${base}/api/v1/instance`, { signal: AbortSignal.timeout(6000) });
      if (seq !== this.probeSeq) {
        return; // a newer probe superseded this one
      }
      if (!res.ok) {
        this.serverStatus.set('unreachable');
        return;
      }
      const info = (await res.json()) as { title?: string };
      if (seq !== this.probeSeq) {
        return;
      }
      this.serverStatus.set('ok');
      this.serverTitle.set(info.title ?? null);
      this.picked.emit(base);
    } catch {
      if (seq === this.probeSeq) {
        this.serverStatus.set('unreachable');
      }
    }
  }

  /** Short host label for the ✓ line. */
  protected hostLabel(): string {
    return normalizeHostUrl(this.customServer()).replace(/^https?:\/\//, '') || 'that server';
  }
}
