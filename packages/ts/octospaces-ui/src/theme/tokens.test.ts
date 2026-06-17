/**
 * Tests for useTokens() — typed, fallback-safe numeric theme token accessors.
 *
 * Verifies:
 *  1. Uses the theme value when the host app provides the token.
 *  2. Falls back to the canonical default when the theme doesn't set the token.
 *  3. Accepts an explicit fallback that overrides the canonical default.
 *  4. radii.sm canonical default is 4 (fixes 4-vs-6 inconsistency).
 */
import { describe, it, expect, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./provider.js', () => ({
  useOctoSpacesTheme: vi.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import { useOctoSpacesTheme } from './provider.js';
import { useTokens } from './tokens.js';
import type { Theme } from './types.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal Theme stub with the supplied token values. */
function makeTheme(overrides: {
  spacing?: Record<string, number>;
  radii?: Record<string, number>;
  layout?: Record<string, number>;
  opacity?: Record<string, number>;
}): Theme {
  return {
    scheme: 'light',
    colors: {} as Theme['colors'],
    spacing: overrides.spacing ?? {},
    radii: overrides.radii ?? {},
    layout: overrides.layout ?? {},
    opacity: overrides.opacity ?? {},
    type: {},
    fonts: {},
    motion: {},
    shadows: {},
    swatches: {},
    layers: {},
    easing: {},
    labelTracking: {},
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useTokens — spacing', () => {
  it('returns the theme value when the host app provides the token', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ spacing: { '2': 10 } }));
    const t = useTokens();
    expect(t.sp('2')).toBe(10);
  });

  it('returns the canonical fallback when the theme does not set the token', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ spacing: {} }));
    const t = useTokens();
    expect(t.sp('1')).toBe(4);
    expect(t.sp('2')).toBe(8);
    expect(t.sp('3')).toBe(12);
    expect(t.sp('4')).toBe(16);
    expect(t.sp('6')).toBe(24);
  });

  it('returns 0 for an unknown key with no canonical fallback', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ spacing: {} }));
    const t = useTokens();
    expect(t.sp('99')).toBe(0);
  });

  it('uses an explicit fallback when provided', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ spacing: {} }));
    const t = useTokens();
    expect(t.sp('99', 777)).toBe(777);
  });

  it('theme value beats both canonical and explicit fallback', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ spacing: { '2': 99 } }));
    const t = useTokens();
    expect(t.sp('2', 0)).toBe(99);
  });
});

describe('useTokens — radii', () => {
  it('returns canonical sm=4 (fixes the 4-vs-6 inconsistency)', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ radii: {} }));
    const t = useTokens();
    // The bug: DiscoverRow.tsx used ?? 6 while SidebarItem.tsx used ?? 4.
    // Canonical is 4.
    expect(t.rad('sm')).toBe(4);
  });

  it('returns theme value when host app provides radii.sm', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ radii: { sm: 6 } }));
    const t = useTokens();
    expect(t.rad('sm')).toBe(6); // host app can still override to 6
  });

  it('returns canonical defaults for common radius keys', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ radii: {} }));
    const t = useTokens();
    expect(t.rad('none')).toBe(0);
    expect(t.rad('xs')).toBe(2);
    expect(t.rad('sm')).toBe(4);
    expect(t.rad('md')).toBe(6);
    expect(t.rad('lg')).toBe(8);
    expect(t.rad('xl')).toBe(12);
    expect(t.rad('full')).toBe(9999);
  });

  it('returns 0 for unknown radius key', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ radii: {} }));
    const t = useTokens();
    expect(t.rad('banana')).toBe(0);
  });

  it('explicit fallback beats canonical for unknown keys', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ radii: {} }));
    const t = useTokens();
    expect(t.rad('banana', 42)).toBe(42);
  });
});

describe('useTokens — layout', () => {
  it('returns theme value for layout tokens', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ layout: { railWidth: 72 } }));
    const t = useTokens();
    expect(t.lay('railWidth')).toBe(72);
  });

  it('returns canonical defaults for railWidth and sidebarWidth', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ layout: {} }));
    const t = useTokens();
    expect(t.lay('railWidth')).toBe(64);
    expect(t.lay('sidebarWidth')).toBe(248);
  });
});

describe('useTokens — opacity', () => {
  it('returns canonical disabled=0.5', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ opacity: {} }));
    const t = useTokens();
    expect(t.opa('disabled')).toBe(0.5);
  });

  it('returns 1 for unknown opacity key', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ opacity: {} }));
    const t = useTokens();
    expect(t.opa('banana')).toBe(1);
  });

  it('theme value wins over canonical', () => {
    vi.mocked(useOctoSpacesTheme).mockReturnValue(makeTheme({ opacity: { disabled: 0.3 } }));
    const t = useTokens();
    expect(t.opa('disabled')).toBe(0.3);
  });
});
