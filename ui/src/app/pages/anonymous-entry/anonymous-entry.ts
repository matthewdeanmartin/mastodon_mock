import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../auth';

/** Shareable entry point that activates the local Anonymous account. */
@Component({
  selector: 'app-anonymous-entry',
  template: '',
})
export class AnonymousEntry implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);

  ngOnInit(): void {
    this.auth.enterAnonymous();
    void this.router.navigateByUrl('/home', { replaceUrl: true });
  }
}
