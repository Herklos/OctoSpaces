/**
 * Theme injection plumbing — provider + hook.
 *
 * The package carries ZERO theme values. The host app builds a concrete {@link Theme}
 * and wraps its tree in `<OctoSpacesThemeProvider theme={resolvedTheme}>`.
 * All primitives then call `useOctoSpacesTheme()` to read the active theme.
 */
import React, { createContext, useContext } from 'react';
import type { Theme } from './types.js';

const ThemeContext = createContext<Theme | null>(null);

export interface OctoSpacesThemeProviderProps {
  theme: Theme;
  children: React.ReactNode;
}

/**
 * Wrap your root component with this provider to inject the resolved Theme into
 * every primitive from `@drakkar.software/octospaces-ui`.
 *
 * @example
 * ```tsx
 * import { OctoSpacesThemeProvider } from '@drakkar.software/octospaces-ui';
 * import { resolvedTheme } from '@/theme'; // your app's theme
 *
 * export default function App() {
 *   return (
 *     <OctoSpacesThemeProvider theme={resolvedTheme}>
 *       <RootNavigator />
 *     </OctoSpacesThemeProvider>
 *   );
 * }
 * ```
 */
export function OctoSpacesThemeProvider({ theme, children }: OctoSpacesThemeProviderProps) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * Read the active theme. Throws if called outside an `<OctoSpacesThemeProvider>` —
 * this is intentional: a missing provider means primitives have no colors/spacing,
 * so a hard failure with a clear message is better than a silent rendering bug.
 */
export function useOctoSpacesTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error(
      '[octospaces-ui] useOctoSpacesTheme() called outside of <OctoSpacesThemeProvider>. ' +
        'Wrap your root component with <OctoSpacesThemeProvider theme={…}>.',
    );
  }
  return theme;
}
