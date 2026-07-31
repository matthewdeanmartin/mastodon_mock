import { Component } from '@angular/core';
import { StatusCard } from '../../status-card/status-card';
import { Status } from '../../models';
import { MAWKINGBIRD_ACCOUNT, virtualTweet } from '../docs/static-status';

/**
 * Credits & Privacy, rendered as a virtual tweet in the centre column. The body
 * is condensed to post-shaped prose (StatusCard sanitises to Mastodon post
 * markup, so full `<section>`/`<h2>` layout wouldn't survive anyway); the links
 * that matter — licenses, the analytics tool, the privacy stance — are kept.
 *
 * The connector section is grouped by what actually leaks (your address, your
 * content, your credentials, your reading habits) rather than by feature area,
 * because that is the question a reader has. It is hand-maintained: when a
 * provider is added under `src/app/providers/`, add it here too.
 */
const CREDITS_BODY = `
<p><strong>Credits &amp; Privacy.</strong></p>
<p>Ships with every page: <a href="https://angular.dev" target="_blank" rel="noopener noreferrer">Angular</a> (MIT), <a href="https://rxjs.dev" target="_blank" rel="noopener noreferrer">RxJS</a> (Apache-2.0), <a href="https://github.com/missive/emoji-mart" target="_blank" rel="noopener noreferrer">emoji-mart</a> (MIT, the same picker <a href="https://elk.zone" target="_blank" rel="noopener noreferrer">Elk</a> uses), <a href="https://github.com/web-mech/badwords-list" target="_blank" rel="noopener noreferrer">badwords-list</a> (MIT) and <a href="https://github.com/microsoft/tslib" target="_blank" rel="noopener noreferrer">tslib</a> (0BSD).</p>
<p>Server directory data comes from the <a href="https://joinmastodon.org/servers" target="_blank" rel="noopener noreferrer">Mastodon server directory</a>.</p>
<p>A static site on <a href="https://pages.github.com/" target="_blank" rel="noopener noreferrer">GitHub Pages</a> — no backend of our own; the app talks directly to whichever Mastodon server you point it at.</p>
<p><strong>Privacy.</strong> Analytics is <a href="https://www.goatcounter.com/" target="_blank" rel="noopener noreferrer">GoatCounter</a>: no cookies, no cross-site tracking, aggregate page-view counts only. Everything else — login, preferences, drafts, local settings — stays in your browser's storage; we don't run a server that could receive it.</p>
<p><strong>Connectors make your privacy complicated.</strong> This client has no backend, so every connector you switch on is your browser talking straight to somebody else's server, under their privacy policy and not ours. We never see that traffic — and we can't protect it either. Nothing below is on until you turn it on.</p>
<p><strong>Sees your IP and every request you route through it:</strong> the CORS proxy. Some third-party APIs refuse browser calls, so the request goes through a proxy first — <a href="https://allorigins.win/" target="_blank" rel="noopener noreferrer">AllOrigins</a>, <a href="https://cors.sh/" target="_blank" rel="noopener noreferrer">CORS.SH</a>, <a href="https://corsfix.com/" target="_blank" rel="noopener noreferrer">Corsfix</a>, <a href="https://corsproxy.io/" target="_blank" rel="noopener noreferrer">CorsProxy.io</a>, or one you host yourself. It is not a VPN, but it is similar in that your traffic passes through a third party who can see the full URL, the headers and your address. Running your own is the private option.</p>
<p><strong>Sees anything you send through it:</strong> pastebins — <a href="https://rentry.co/" target="_blank" rel="noopener noreferrer">Rentry</a>, PastePile, <a href="https://tinyurl.com/" target="_blank" rel="noopener noreferrer">TinyURL</a> — and link shorteners — TinyURL, <a href="https://is.gd/" target="_blank" rel="noopener noreferrer">is.gd</a>, <a href="https://dub.co/" target="_blank" rel="noopener noreferrer">Dub</a>, <a href="https://short.io/" target="_blank" rel="noopener noreferrer">Short.io</a>, <a href="https://t.ly/" target="_blank" rel="noopener noreferrer">T.LY</a>, <a href="https://www.rebrandly.com/" target="_blank" rel="noopener noreferrer">Rebrandly</a>. Paste text and shortened destinations land on their servers. Most shortened links are public to anyone who guesses the slug, and shorteners log every click.</p>
<p><strong>Holds a credential of yours:</strong> <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">Bluesky</a> (app password, for feeds and DMs), <a href="https://www.dropbox.com/" target="_blank" rel="noopener noreferrer">Dropbox</a> and <a href="https://github.com/" target="_blank" rel="noopener noreferrer">GitHub</a> (backups and exports), <a href="https://raindrop.io/" target="_blank" rel="noopener noreferrer">Raindrop</a> (bookmarks), <a href="https://openrouter.ai/" target="_blank" rel="noopener noreferrer">OpenRouter</a> (AI translation and suggestions — your text goes to whichever model you pick, and its provider's retention terms apply). Tokens are stored in your browser only, but the service on the other end sees your usage.</p>
<p><strong>Sees what you read:</strong> every RSS host you subscribe to learns your address and your polling schedule, as does any Mastodon server you point the client at. Twitter content is obtained by screen scraping; no claims are made about its legal status.</p>
<p><strong>Forks.</strong> Anyone can fork this client and host their own copy — it's open source and static, so that's easy and expected. If you are using a fork, your relationship is with whoever runs it, not with us. They can change any of the above, including adding tracking or pointing connectors somewhere else. Check the URL in your address bar.</p>
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
