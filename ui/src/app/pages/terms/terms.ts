import { Component, inject, OnInit } from '@angular/core';
import { ServerAbout } from '../../server-about';

/** Terms of service published by the connected Mastodon instance. */
@Component({
  selector: 'app-terms',
  templateUrl: './terms.html',
  styleUrl: './terms.css',
})
export class Terms implements OnInit {
  private serverAbout = inject(ServerAbout);

  protected terms = this.serverAbout.terms;
  protected loading = this.serverAbout.loading;

  ngOnInit(): void {
    this.serverAbout.load();
  }
}
