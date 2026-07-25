import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StarterKitPost } from '../../starter-kit-post/starter-kit-post';
import { SHIPPED_STARTER_KITS } from '../../starter-kits';

@Component({
  selector: 'app-starter-kits',
  imports: [RouterLink, StarterKitPost],
  templateUrl: './starter-kits.html',
  styleUrl: './starter-kits.css',
})
export class StarterKits {
  protected readonly kits = SHIPPED_STARTER_KITS;
}
