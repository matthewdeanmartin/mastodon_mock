import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  constructor(title: Title) {
    // Set the tab title from the build flavor (mastodon_mock vs Mocking Bird).
    title.setTitle(environment.brand);
  }
}
