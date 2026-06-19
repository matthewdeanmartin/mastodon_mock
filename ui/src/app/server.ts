import { Injectable, signal } from '@angular/core';

const SERVER_KEY = 'mastodon_mock_server';

export interface ServerPreset {
  label: string;
  /** Empty string means "this server" (relative URLs, same origin as the UI). */
  baseUrl: string;
}

export const SERVER_PRESETS: ServerPreset[] = [
  { label: 'This server (mastodon_mock)', baseUrl: '' },
  { label: 'mastodon.social', baseUrl: 'https://mastodon.social' },
];

/** Holds the chosen instance base URL, persisted across reloads. */
@Injectable({ providedIn: 'root' })
export class Server {
  readonly baseUrl = signal<string>(this.normalize(localStorage.getItem(SERVER_KEY) ?? ''));

  /** True when targeting the local mock (relative URLs / same origin as the UI). */
  get isMock(): boolean {
    return this.baseUrl() === '';
  }

  setBaseUrl(value: string): void {
    const normalized = this.normalize(value);
    localStorage.setItem(SERVER_KEY, normalized);
    this.baseUrl.set(normalized);
  }

  private normalize(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed) {
      return '';
    }
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
}
