import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FeatureFlagDefinition, FeatureFlagState, FeatureFlags } from '../../../feature-flags';

/** Browser-local rollout controls for features that are still being staged. */
@Component({
  selector: 'app-settings-feature-flags',
  imports: [FormsModule],
  templateUrl: './settings-feature-flags.html',
})
export class SettingsFeatureFlags {
  protected readonly flags = inject(FeatureFlags);

  protected state(flag: FeatureFlagDefinition): FeatureFlagState {
    return this.flags.state(flag.id);
  }

  protected setState(flag: FeatureFlagDefinition, state: FeatureFlagState): void {
    this.flags.setState(flag.id, state);
  }
}
