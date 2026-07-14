import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The fail whale, on demand and with no side effects: a nostalgia page linked
 * from the footer. The real one still appears on its own when the server is
 * actually unreachable.
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
      <a class="btn" routerLink="/home">Back to your feed</a>
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
  `,
})
export class FailWhaleDemo {}
