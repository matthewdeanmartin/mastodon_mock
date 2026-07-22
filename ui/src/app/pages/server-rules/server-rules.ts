import { Component, inject, OnInit } from '@angular/core';
import { ServerAbout } from '../../server-about';

/** Rules published by the connected Mastodon instance. */
@Component({
  selector: 'app-server-rules',
  templateUrl: './server-rules.html',
  styleUrl: './server-rules.css',
})
export class ServerRules implements OnInit {
  private serverAbout = inject(ServerAbout);

  protected rules = this.serverAbout.rules;
  protected loading = this.serverAbout.loading;

  ngOnInit(): void {
    this.serverAbout.load();
  }
}
