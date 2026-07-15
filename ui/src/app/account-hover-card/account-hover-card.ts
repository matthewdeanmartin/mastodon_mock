import { Component, input } from '@angular/core';
import { Account } from '../models';
import { VerifiedBadge } from '../verified-badge/verified-badge';

/**
 * Small info-only card shown when hovering an account's avatar or name:
 * bio + post/following/follower counts, no actions. Purely presentational —
 * the wrapping element (`.hover-anchor`, see status-card.css) owns the
 * show-on-hover behavior, and the data is the `Account` already embedded in
 * the status, so hovering costs zero requests.
 */
@Component({
  selector: 'app-account-hover-card',
  imports: [VerifiedBadge],
  template: `
    <div class="hover-card">
      <img class="hc-avatar" [src]="account().avatar" alt="" />
      <div class="hc-name">
        {{ account().display_name || account().username }}
        <app-verified-badge [account]="account()" />
      </div>
      <div class="hc-acct muted">&#64;{{ account().acct }}</div>
      @if (account().note) {
        <div class="hc-note" [innerHTML]="account().note"></div>
      }
      <div class="hc-stats muted">
        <span
          ><strong>{{ account().statuses_count }}</strong> posts</span
        >
        <span
          ><strong>{{ account().following_count }}</strong> following</span
        >
        <span
          ><strong>{{ account().followers_count }}</strong> followers</span
        >
      </div>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 40;
      visibility: hidden;
      opacity: 0;
      transition:
        opacity 0.12s ease,
        visibility 0.12s;
      /* Info only: never intercept clicks meant for what's underneath. */
      pointer-events: none;
    }
    .hover-card {
      width: 280px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--panel);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
      font-weight: 400;
      font-size: 14px;
      line-height: 1.4;
      text-align: left;
      white-space: normal;
    }
    .hc-avatar {
      width: 48px;
      height: 48px;
      border-radius: 9999px;
      object-fit: cover;
      background: var(--border);
    }
    .hc-name {
      margin-top: 6px;
      font-weight: 700;
      color: var(--text);
    }
    .hc-acct {
      font-size: 13px;
    }
    .hc-note {
      margin-top: 6px;
      color: var(--text);
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
    }
    .hc-stats {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      font-size: 13px;
    }
    .hc-stats strong {
      color: var(--text);
    }
  `,
})
export class AccountHoverCard {
  readonly account = input.required<Account>();
}
