import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { EmailNotificationSettings } from '../../../models';

/** Email notification toggles (mock-only settings section). */
@Component({
  selector: 'app-settings-notifications',
  imports: [FormsModule],
  templateUrl: './settings-notifications.html',
})
export class SettingsNotifications implements OnInit {
  private api = inject(Api);

  protected follow = signal(false);
  protected followRequest = signal(false);
  protected reblog = signal(false);
  protected favourite = signal(false);
  protected mention = signal(false);
  protected report = signal(false);
  protected digest = signal(false);
  protected saving = signal(false);
  protected saved = signal(false);

  ngOnInit(): void {
    this.api.mockSettings().subscribe((settings) => {
      const n = settings.email_notifications;
      this.follow.set(n.follow);
      this.followRequest.set(n.follow_request);
      this.reblog.set(n.reblog);
      this.favourite.set(n.favourite);
      this.mention.set(n.mention);
      this.report.set(n.report);
      this.digest.set(n.digest);
    });
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);

    const emailNotifications: EmailNotificationSettings = {
      follow: this.follow(),
      follow_request: this.followRequest(),
      reblog: this.reblog(),
      favourite: this.favourite(),
      mention: this.mention(),
      report: this.report(),
      digest: this.digest(),
    };

    this.api.updateMockSettings({ email_notifications: emailNotifications }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
      },
      error: () => this.saving.set(false),
    });
  }
}
