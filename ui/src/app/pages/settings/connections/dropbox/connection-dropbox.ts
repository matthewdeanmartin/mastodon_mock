import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DropboxEntry, DropboxSession } from '../../../../providers/dropbox/dropbox-session';

/**
 * Settings → Connections → Dropbox. The OAuth round trip lands back here (see
 * `pages/dropbox-callback`), so this page also reads the `?dropbox=` result.
 */
@Component({
  selector: 'app-connection-dropbox',
  imports: [RouterLink],
  templateUrl: './connection-dropbox.html',
  styleUrls: ['../connection-page.css', './connection-dropbox.css'],
})
export class ConnectionDropbox implements OnInit {
  protected dropbox = inject(DropboxSession);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected dropboxBusy = signal(false);
  protected dropboxError = signal<string | null>(null);
  protected dropboxNotice = signal<string | null>(null);
  protected dropboxEntries = signal<DropboxEntry[] | null>(null);

  ngOnInit(): void {
    const result = this.route.snapshot.queryParamMap.get('dropbox');
    if (result === 'connected') {
      this.dropboxNotice.set('Dropbox connected.');
    } else if (result === 'error') {
      this.dropboxError.set(
        this.route.snapshot.queryParamMap.get('message') ?? 'Dropbox authorization failed.',
      );
    }
    if (result) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  async connectDropbox(): Promise<void> {
    this.dropboxError.set(null);
    this.dropboxNotice.set(null);
    try {
      await this.dropbox.connect();
    } catch (error: unknown) {
      this.dropboxError.set(describeError(error, "Couldn't start Dropbox authorization."));
    }
  }

  async listDropbox(): Promise<void> {
    if (this.dropboxBusy()) {
      return;
    }
    this.dropboxBusy.set(true);
    this.dropboxError.set(null);
    try {
      this.dropboxEntries.set(await this.dropbox.listRoot());
    } catch (error: unknown) {
      this.dropboxError.set(describeError(error, "Couldn't list your Dropbox files."));
    } finally {
      this.dropboxBusy.set(false);
    }
  }

  disconnectDropbox(): void {
    this.dropbox.disconnect();
    this.dropboxEntries.set(null);
    this.dropboxNotice.set(null);
  }
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
