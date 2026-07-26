import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SearchServer } from '../../search-server';
import { SearchServerAbout } from '../../search-server-about';
import { ServerAbout } from '../../server-about';

/**
 * Docs hub: a centre-column index of the "blog-post"-style pages (Design,
 * Credits) plus the server's own legal pages (Rules, Terms) when it publishes
 * them. This is where Server rules / Terms / Credits moved to once they came off
 * the More menu — reachable, but no longer taking a top-level slot.
 */
@Component({
  selector: 'app-docs',
  imports: [RouterLink],
  templateUrl: './docs.html',
  styleUrl: './docs.css',
})
export class Docs implements OnInit {
  protected serverAbout = inject(ServerAbout);
  protected searchServerAbout = inject(SearchServerAbout);
  protected searchServer = inject(SearchServer);

  ngOnInit(): void {
    // So the Rules/Terms rows can appear only when the instance actually has them.
    this.serverAbout.load();
    // Two servers means two sets of house rules; list the search server's too.
    this.searchServerAbout.load();
  }
}
