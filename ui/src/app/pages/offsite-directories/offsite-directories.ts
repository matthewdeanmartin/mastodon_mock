import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A link list of people-finding directories that live on other sites.
 *
 * Named for what it is rather than what it is for: "Find people" was the same
 * promise the Find Friends hub makes, and having both meant the prominent
 * "who to follow" links landed on whichever one happened to be wired up. This
 * is one row on that hub now — the offsite half, where every destination opens
 * in a new tab and nothing can be followed without leaving.
 */
@Component({
  selector: 'app-offsite-directories',
  imports: [RouterLink],
  templateUrl: './offsite-directories.html',
  styleUrl: './offsite-directories.css',
})
export class OffsiteDirectories {
  /** True when hosted inside another page (e.g. search's empty state): no page title. */
  readonly embedded = input(false);
}
