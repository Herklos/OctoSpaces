/**
 * A settings row whose trailing accessory is a {@link Toggle}.
 * Fully headless — the leading icon is injected as a ReactNode so the host
 * app supplies its own icon component (Feather, MCI, SFSymbols, etc.).
 *
 * ```tsx
 * <ToggleRow
 *   icon={<Icon name="bell" size={18} />}
 *   label="Notifications"
 *   detail="Push + in-app"
 *   value={notif}
 *   onValueChange={setNotif}
 * />
 * ```
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { TextStyle } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';
import { Toggle } from './Toggle.js';

export interface ToggleRowProps {
  /** Leading icon element injected by the host app. */
  icon?: React.ReactNode;
  label: string;
  /** Optional secondary descriptor below the label. */
  detail?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Dims the row and disables the toggle — for a sub-setting gated behind a
   *  master toggle. */
  disabled?: boolean;
}

export function ToggleRow({ icon, label, detail, value, onValueChange, disabled }: ToggleRowProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();
  const { colors, type: typeScale, fonts } = theme;

  const sp2 = t.sp('2');
  const sp3 = t.sp('3');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp3,
        paddingVertical: sp2 / 2,
        opacity: disabled ? t.opa('disabled') : 1,
      }}
    >
      {icon != null ? (
        <View style={{ width: 20, alignItems: 'center', flexShrink: 0 }}>{icon}</View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={
            {
              fontSize: (typeScale['callout']?.size as number | undefined) ?? 13,
              lineHeight: (typeScale['callout']?.lineHeight as number | undefined) ?? 18,
              fontWeight: '600',
              color: colors.text,
              fontFamily: fonts['body'] ?? undefined,
            } as TextStyle
          }
        >
          {label}
        </Text>
        {detail != null ? (
          <Text
            numberOfLines={2}
            style={
              {
                fontSize: (typeScale['caption']?.size as number | undefined) ?? 11,
                lineHeight: (typeScale['caption']?.lineHeight as number | undefined) ?? 16,
                color: colors.textTertiary,
                fontFamily: fonts['body'] ?? undefined,
                marginTop: 1,
              } as TextStyle
            }
          >
            {detail}
          </Text>
        ) : null}
      </View>
      <Toggle
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
      />
    </View>
  );
}
