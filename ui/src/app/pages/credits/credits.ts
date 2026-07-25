import { Component } from '@angular/core';
import { StatusCard } from '../../status-card/status-card';
import { Status } from '../../models';
import { MAWKINGBIRD_ACCOUNT, virtualTweet } from '../docs/static-status';

/**
 * Credits & Privacy, rendered as a virtual tweet in the centre column. The body
 * is condensed to post-shaped prose (StatusCard sanitises to Mastodon post
 * markup, so full `<section>`/`<h2>` layout wouldn't survive anyway); the links
 * that matter — licenses, the analytics tool, the privacy stance — are kept.
 */
const CREDITS_BODY = `
<p><strong>Credits &amp; Privacy.</strong></p>
<p>Ships with every page: <a href="https://angular.dev" target="_blank" rel="noopener noreferrer">Angular</a> (MIT), <a href="https://rxjs.dev" target="_blank" rel="noopener noreferrer">RxJS</a> (Apache-2.0), <a href="https://github.com/missive/emoji-mart" target="_blank" rel="noopener noreferrer">emoji-mart</a> (MIT, the same picker <a href="https://elk.zone" target="_blank" rel="noopener noreferrer">Elk</a> uses), <a href="https://github.com/web-mech/badwords-list" target="_blank" rel="noopener noreferrer">badwords-list</a> (MIT) and <a href="https://github.com/microsoft/tslib" target="_blank" rel="noopener noreferrer">tslib</a> (0BSD).</p>
<p>Server directory data comes from the <a href="https://joinmastodon.org/servers" target="_blank" rel="noopener noreferrer">Mastodon server directory</a>.</p>
<p>A static site on <a href="https://pages.github.com/" target="_blank" rel="noopener noreferrer">GitHub Pages</a> — no backend of our own; the app talks directly to whichever Mastodon server you point it at.</p>
<p><strong>Privacy.</strong> Analytics is <a href="https://www.goatcounter.com/" target="_blank" rel="noopener noreferrer">GoatCounter</a>: no cookies, no cross-site tracking, aggregate page-view counts only. Everything else — login, preferences, drafts, local settings — stays in your browser's storage; we don't run a server that could receive it. Pastes and short links go straight to the third party you pick, under their own terms.</p>
`;

@Component({
  selector: 'app-credits',
  imports: [StatusCard],
  templateUrl: './credits.html',
  styleUrl: './credits.css',
})
export class Credits {
  protected status: Status = virtualTweet({
    id: 'mawkingbird:credits',
    content: CREDITS_BODY,
    account: MAWKINGBIRD_ACCOUNT,
  });
}
