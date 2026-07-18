import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The project's public, logged-out about page. */
@Component({
  selector: 'app-about',
  imports: [RouterLink],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class About {}
