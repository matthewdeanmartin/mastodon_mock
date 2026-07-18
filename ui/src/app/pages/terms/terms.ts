import { Component, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../api';
import { TermsOfService } from '../../models';

/** Terms of service published by the connected Mastodon instance. */
@Component({
  selector: 'app-terms',
  templateUrl: './terms.html',
  styleUrl: './terms.css',
})
export class Terms implements OnInit {
  private api = inject(Api);

  protected terms = signal<TermsOfService | null>(null);
  protected loading = signal(true);

  ngOnInit(): void {
    this.api.termsOfService().subscribe({
      next: (terms) => {
        this.terms.set(terms);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
