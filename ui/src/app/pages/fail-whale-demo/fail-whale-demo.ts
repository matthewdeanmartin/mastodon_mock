import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InstanceStatus } from '../../instance-status';

/**
 * The fail whale, on demand and with no side effects: a nostalgia page linked
 * from the footer. The real one still appears on its own when the server is
 * actually unreachable — and so this page also previews the status link the
 * real whale would offer for the currently selected instance (see
 * {@link InstanceStatus}).
 */
@Component({
  selector: 'app-fail-whale-demo',
  imports: [RouterLink],
  template: `
    <div class="whale-page center">
      <img class="whale-img" src="insufficient_whale.png" alt="The fail whale" />
      <h1>The Fail Whale</h1>
      <p class="muted">
        Too many tweets... please wait a moment and try again. (Don't worry — nothing is actually
        broken. This one is just here for the memories. If the server ever really goes down, the
        whale will find you.)
      </p>
      @if (status.currentDomain(); as domain) {
        <p class="muted">And if {{ domain }} ever really is down, the whale will offer this:</p>
      }
      <div class="actions">
        @if (status.statusLink(); as link) {
          <a class="btn" [href]="link.url" target="_blank" rel="noopener noreferrer">
            {{ link.label }}
          </a>
        }
        <a class="btn" routerLink="/home">Back to your feed</a>
      </div>
    </div>
  `,
  styles: `
    .whale-page {
      padding: 48px 24px;
    }
    .whale-img {
      max-width: 320px;
      width: 100%;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 8px;
    }
    p {
      max-width: 460px;
      margin: 0 auto 20px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
    }
  `,
})
export class FailWhaleDemo {
  protected status = inject(InstanceStatus);
}
