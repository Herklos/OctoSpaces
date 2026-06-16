/**
 * Headless on/off toggle — wraps the platform `Switch` so every settings
 * toggle picks up the host app's primary accent track in one place.
 *
 * ```tsx
 * <Toggle
 *   value={enabled}
 *   onValueChange={setEnabled}
 *   accessibilityLabel="Enable notifications"
 * />
 * ```
 */
import React from 'react';
import { Switch } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: ToggleProps) {
  const { colors } = useOctoSpacesTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={colors.surface}
      ios_backgroundColor={colors.border}
    />
  );
}
