/**
 * Minimal Theme fixture + render helper for component tests.
 *
 * The package ships no theme values, so component tests must inject one. This
 * fixture supplies just enough for primitives to render; it is cast to `Theme`
 * because tests only exercise the fields a given component reads.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { OctoSpacesThemeProvider } from '../theme/provider.js';
import type { Theme } from '../theme/types.js';

export const testTheme = {
  scheme: 'light',
  colors: {
    primary: '#3b82f6',
    primaryMuted: '#1d4ed8',
    primarySubtle: '#eff6ff',
    danger: '#ef4444',
    text: '#111111',
    textSecondary: '#666666',
    textTertiary: '#999999',
    textInverse: '#ffffff',
    textOnPrimary: '#ffffff',
    background: '#ffffff',
    surface: '#f5f5f5',
    surfaceInput: '#fafafa',
    border: '#e5e5e5',
    borderSubtle: '#eeeeee',
  },
  spacing: { '0': 0, '0.5': 2, '1': 4, '2': 8, '3': 12, '4': 16 },
  radii: { none: 0, sm: 4, md: 6, lg: 8, xl: 12, full: 9999 },
  type: {
    title2:   { size: 22, lineHeight: 28, weight: '700' },
    heading:  { size: 15, lineHeight: 20, weight: '600' },
    body:     { size: 15, lineHeight: 22 },
    callout:  { size: 14, lineHeight: 18 },
    caption:  { size: 12, lineHeight: 18 },
    footnote: { size: 13, lineHeight: 16 },
    micro:    { size: 10, lineHeight: 13 },
  },
  fonts: { body: 'System', heading: 'System', mono: 'Menlo' },
  motion: {},
  shadows: {},
  layout: { railWidth: 64, sidebarWidth: 248 },
  opacity: { disabled: 0.5, subtle: 0.7, muted: 0.4 },
  swatches: {},
  layers: {},
  easing: {},
  labelTracking: {},
} as unknown as Theme;

/** Render `ui` wrapped in the theme provider with the test fixture theme. */
export function renderThemed(ui: React.ReactElement, theme: Theme = testTheme) {
  return render(<OctoSpacesThemeProvider theme={theme}>{ui}</OctoSpacesThemeProvider>);
}
