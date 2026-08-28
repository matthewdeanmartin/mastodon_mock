import { Component, output } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * What you can type when searching for people.
 *
 * The counterpart to `search-syntax-help`, documenting the *accounts* tab.
 *
 * ## Post operators work here, and that is not obvious
 *
 * Mastodon's own docs describe account search as a name/bio lookup with no
 * query language, and reading only the API contract leads to the wrong
 * conclusion — that operators typed here are matched as literal words. They are
 * not, because of how Mawkingbird composes this search.
 *
 * `fetchAccounts` (search.ts) runs up to **two branches** and merges them:
 *
 * - the **bio** branch — `api.search(q, 'accounts')`, a name/bio lookup;
 * - the **posts** branch — `api.search(q, 'statuses')`, the very same full-text
 *   post search the Posts tab runs, whose hits are then grouped by author via
 *   `condenseStatusesToAuthors`.
 *
 * `q` is passed through verbatim to both. So an operator on this tab reaches the
 * post-search endpoint exactly as it would from the Posts tab, and is honoured
 * wherever it would be honoured there. "Find me people who post about X" is a
 * first-class use of this box, not an accident — the `What they post` source
 * option exists to select that branch alone.
 *
 * Which is why this documents the operators rather than denying them: a reader
 * who has been told "no operators here" will not try the thing that works.
 *
 * ## What it must not claim
 *
 * The bio branch is a plain substring match — an operator means nothing to it,
 * so a query that leans on operators narrows the *posts* half and does nothing
 * to the *names* half. That asymmetry is the honest caveat, and it is stated on
 * screen rather than smoothed over.
 *
 * Care is still owed to `search-syntax-help`'s warning: an operator the server
 * does not honour fails *silently*, returning more results rather than an error.
 * Nothing here should be documented that is not documented there, and the two
 * lists are deliberately not duplicated — this one points at the shared
 * reference instead of restating it and drifting from it.
 *
 * This replaced a list of offsite directories in the idle accounts state. That
 * list was a distractor — finding people has its own hub at `/find-friends`, and
 * the question someone staring at an empty *search* box has is "what do I type
 * here?", the same question the post tab already answers.
 */
@Component({
  selector: 'app-account-search-help',
  imports: [RouterLink],
  template: `
    <section aria-labelledby="account-search-help-title">
      <h3 id="account-search-help-title">Searching for people</h3>
      <p class="muted note">
        Two searches at once: one over names and bios, one over what people
        <em>post</em> — with the posts grouped by who wrote them. So you can look someone up by
        name, or find people by what they talk about.
      </p>

      <div class="groups">
        <section>
          <h4>What you can type</h4>
          <table>
            <tbody>
              <tr>
                <td class="syntax"><code>&#64;name&#64;server.social</code></td>
                <td>
                  A full address. This is the reliable one: your server goes and fetches that exact
                  account even if it has never seen it before.
                  <span class="example"><code>&#64;Gargron&#64;mastodon.social</code></span>
                </td>
              </tr>
              <tr>
                <td class="syntax"><code>https://…</code></td>
                <td>
                  A link to someone's profile, pasted whole. Resolved the same way as an address.
                </td>
              </tr>
              <tr>
                <td class="syntax"><code>name</code></td>
                <td>
                  A handle or display name. Matches accounts your server already knows about, so
                  results depend on which server you are searching.
                </td>
              </tr>
              <tr>
                <td class="syntax"><code>baking cookies</code></td>
                <td>
                  Any words. Searches bios <em>and</em> posts, so you get people who describe
                  themselves this way plus people who write about it.
                </td>
              </tr>
              <tr>
                <td class="syntax"><code>from:&#64;name&#64;server</code></td>
                <td>
                  Post operators work here too — they run against the posts half of the search.
                  <code>has:media</code>, <code>after:</code>, <code>-is:reply</code> and the rest
                  all apply.
                  <span class="example"><code>rust -is:reply has:media</code></span>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="muted group-note">
            One caveat worth knowing: operators only narrow the <em>posts</em> half. The
            names-and-bios half is a plain text match and ignores them, so a heavily-operatored
            query still returns whatever accounts matched the words by name.
            <button type="button" class="linklike" (click)="syntaxHelp.emit()">
              See all post operators
            </button>
          </p>
        </section>

        <section>
          <h4>Narrowing it down</h4>
          <p class="muted group-note">
            These are controls, not things you type — they are under
            <strong>Advanced&nbsp;▾</strong>, and beside the results once a search has run.
          </p>
          <table>
            <tbody>
              <tr>
                <td class="syntax">Search in</td>
                <td>
                  Which half runs: <strong>Bio and posts</strong> (both, the default),
                  <strong>Name &amp; bio only</strong>, or <strong>What they post</strong>. Pick the
                  last one when you want people by subject and don't care what their bio says.
                </td>
              </tr>
              <tr>
                <td class="syntax">Followers</td>
                <td>A minimum, a maximum, or both — for skipping past the very large accounts.</td>
              </tr>
              <tr>
                <td class="syntax">Posts</td>
                <td>Filters out accounts that registered and never wrote anything.</td>
              </tr>
              <tr>
                <td class="syntax">Filters</td>
                <td>
                  After results arrive: by server, by whether you already follow them, by how
                  recently they posted.
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <p class="muted note footer-note">
        Searching for a name and finding nothing usually means your server has not met that account
        yet, rather than that it does not exist — the full <code>&#64;name&#64;server</code> address
        finds it anyway. Browsing rather than looking for someone specific?
        <a routerLink="/find-friends">Find friends</a> has directories and follow-list imports.
      </p>
    </section>
  `,
  styles: `
    /* Matched to search-syntax-help: this is the same kind of reference shown in
       the same place, and two references that look alike are one thing to learn
       instead of two. */
    h3 {
      margin: 0 0 4px;
      font-size: 1.05em;
    }
    .note {
      margin: 0 0 16px;
      font-size: 0.9em;
    }
    .groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    h4 {
      margin: 0 0 4px;
    }
    .group-note {
      margin: 0 0 8px;
      font-size: 0.85em;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.9em;
    }
    td {
      padding: 3px 8px 3px 0;
      vertical-align: top;
    }
    .syntax {
      white-space: nowrap;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.95em;
    }
    .example {
      display: block;
      margin-top: 2px;
      opacity: 0.75;
    }
    .footer-note {
      margin: 16px 0 0;
    }
    /* A button that reads as a link, for the inline "See all post operators".
       Same shape as the one in home.css; component styles are scoped, so it
       does not carry across. */
    .linklike {
      border: none;
      background: none;
      color: var(--accent);
      font: inherit;
      padding: 0;
      cursor: pointer;
      text-decoration: underline;
    }
  `,
})
export class AccountSearchHelp {
  /**
   * Open the full operator reference.
   *
   * Emitted rather than rendering the operator table inline: `search-syntax-help`
   * is generated from `mastodon-query-serializer.ts` precisely so the documented
   * operators cannot drift from the emitted ones, and a second copy here would
   * be the drift it exists to prevent.
   */
  readonly syntaxHelp = output<void>();
}
