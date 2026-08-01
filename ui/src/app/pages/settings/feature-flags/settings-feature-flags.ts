import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  FeatureFlagDefinition,
  FeatureFlagState,
  FeatureFlags,
  flagsInGroup,
} from '../../../feature-flags';

const STATE_LABELS: Record<FeatureFlagState, string> = {
  production: 'Production',
  canary: 'Canary only',
  off: 'Off everywhere',
};

/** Browser-local rollout controls for features that are still being staged. */
@Component({
  selector: 'app-settings-feature-flags',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-feature-flags.html',
})
export class SettingsFeatureFlags {
  protected readonly flags = inject(FeatureFlags);

  protected readonly featureFlags = flagsInGroup('features');
  protected readonly connectorFlags = flagsInGroup('connectors');

  protected state(flag: FeatureFlagDefinition): FeatureFlagState {
    return this.flags.state(flag.id);
  }

  protected setState(flag: FeatureFlagDefinition, state: FeatureFlagState): void {
    this.flags.setState(flag.id, state);
  }

  /** "Default for this release: X. It is currently on/off on this build." */
  protected defaultHint(flag: FeatureFlagDefinition): string {
    const enabled = this.flags.enabled(flag.id) ? 'enabled' : 'disabled';
    const channel = this.flags.isCanary ? 'canary' : 'production';
    return `Default for this release: ${STATE_LABELS[flag.defaultState]}. It is currently ${enabled} on this ${channel} build.`;
  }
}
