import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../auth';
import { Server } from '../../server';
import { PreviewSeed, PREVIEW_SERVER } from '../../first-run/preview-seed';
import { probeServerAvailability } from '../../server-availability';

/**
 * Servers tried, in order, for the first-run preview.
 *
 * `mastodon.social` is blocked on some networks and a blocked front door is a
 * blank first impression, so the preview falls back rather than failing. The
 * picker stays off the front door entirely: a stranger cannot be expected to
 * have an opinion about which Mastodon server to read.
 */
const PREVIEW_SERVERS: readonly string[] = [
  PREVIEW_SERVER,
  'https://mas.to',
  'https://fosstodon.org',
];

/**
 * `/` — a router, not a page. It renders nothing of its own.
 *
 * This is the correction at the centre of sprint 2b. `/` used to be a marketing
 * landing page, which meant a stranger's first sight of a social media client
 * was a page that was not one. Now it reads existing state and dispatches:
 *
 * | arriving as | goes to |
 * |---|---|
 * | signed in (Mastodon or Bluesky) | `/home` |
 * | anonymous, already chosen | `/home`, no modal — the choice was durable |
 * | mid-preview (reloaded with the modal open) | `/home`, modal again |
 * | nobody at all | enter Anonymous, seed the preview, `/home` with the modal |
 *
 * Because a pitch is never rendered here, the worst failure of the old design —
 * showing marketing to a signed-in user, which reads as "the app logged me
 * out" — is not mitigated but structurally impossible.
 */
@Component({
  selector: 'app-entry',
  template: '',
})
export class EntryPage implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);
  private server = inject(Server);
  private preview = inject(PreviewSeed);

  async ngOnInit(): Promise<void> {
    // A returning visitor of any kind — including one who chose to stay
    // anonymous — goes straight to the app. Re-asking a settled question is
    // how the previous front door annoyed people who had already answered.
    // The mid-preview case is the exception: that account exists because we
    // made it, not because they asked for it, so the question still stands.
    if (!this.auth.isAuthenticated && !this.preview.active) {
      await this.startPreview();
    }
    await this.router.navigateByUrl('/home', { replaceUrl: true });
  }

  /**
   * Enter Anonymous and seed three follows so `/home` has real posts to show.
   *
   * Entering before the visitor has agreed to anything is deliberate: it is the
   * only way the timeline behind the modal can be real. The account is
   * browser-local, costs no network identity, and every exit from the modal
   * clears the seed — including the ones that lead to a real login.
   *
   * If every candidate server is unreachable the preview is skipped rather than
   * retried: the modal still appears over an empty feed and both answers still
   * work. A network failure must never block the choice.
   */
  private async startPreview(): Promise<void> {
    for (const candidate of PREVIEW_SERVERS) {
      const result = await probeServerAvailability(candidate);
      if (result.status !== 'unreachable') {
        this.server.setBaseUrl(candidate);
        this.auth.enterAnonymous(candidate);
        await this.preview.seed(candidate);
        return;
      }
    }
    // No reachable server: still enter, so the shell renders and the modal can
    // be answered. `/home` shows its ordinary empty state behind it.
    this.server.setBaseUrl(PREVIEW_SERVER);
    this.auth.enterAnonymous(PREVIEW_SERVER);
    this.preview.markEmpty(PREVIEW_SERVER);
  }
}
