import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnonymousPreferences } from '../../../providers/anonymous/anonymous-preferences';

@Component({
  selector: 'app-settings-anonymous',
  imports: [FormsModule],
  templateUrl: './settings-anonymous.html',
  styleUrl: './settings-anonymous.css',
})
export class SettingsAnonymous {
  protected prefs = inject(AnonymousPreferences);
  protected readonly ageOptions = [
    { days: 30, label: '30 days' },
    { days: 90, label: '3 months' },
    { days: 180, label: '6 months' },
    { days: 365, label: '1 year' },
    { days: 730, label: '2 years' },
    { days: 1825, label: '5 years' },
  ];

  protected setMaximumAge(days: string | number): void {
    this.prefs.setFollowedPostMaxAgeDays(Number(days));
  }
}
