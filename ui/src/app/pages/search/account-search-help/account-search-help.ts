import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * What you can type when searching for people.
 *
 * The counterpart to `search-syntax-help`, and deliberately a different shape,
 * because account search is a different thing. Post search has an operator
 * language (`from:`, `has:media`, `-is:reply`); **account search has none** —
 * the text box is passed to the server as-is, and every refinement lives in the
 * Advanced form and the facet checkboxes instead.
 *
 * So this documents what the box actually does with what you type, and points
 * at where the real filtering is. It is not an operator table, because inventing
 * one would be the exact failure `search-syntax-help` warns about: an operator
 * the server does not honour fails *silently*, returning more results than asked
 * for rather than an error, which teaches people to write queries that lie to
 * them. `from:` typed into a people search is matched as the literal word
 * "from:".
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
        Unlike post search, this box has no operators — what you type is matched as words. Type
        <code>from:</code> here and it looks for accounts with "from:" in them.
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
                <td class="syntax"><code>words about them</code></td>
                <td>
                  Words from a profile bio — "rust compiler", "birding". Turn this on with
                  <strong>Search in</strong> under Advanced.
                </td>
              </tr>
            </tbody>
          </table>
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
                  Look in profiles, in the authors of matching posts, or both. "Posts" finds people
                  by what they write rather than what they say about themselves.
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
  `,
})
export class AccountSearchHelp {}
