import { describe, it, expect } from 'vitest';
import type { Palette, Theme } from './types.js';
import {
  avatarTint,
  focusRingStyle,
  glowShadow,
  paperBorder,
  presenceColor,
  statusColor,
  swatch,
  verificationColor,
} from './helpers.js';

const mockPalette: Palette = {
  background: '#000',
  surface: '#111',
  surfaceElevated: '#222',
  surfaceModal: '#333',
  surfaceInput: '#444',
  sidebar: '#555',
  sidebarActive: '#666',
  border: '#777',
  borderSubtle: '#888',
  borderStrong: '#999',
  text: '#fff',
  textSecondary: '#eee',
  textTertiary: '#ddd',
  textDisabled: '#ccc',
  textInverse: '#000',
  textOnPrimary: '#fff',
  primary: '#6366f1',
  primaryHover: '#4f46e5',
  primaryMuted: '#312e81',
  primarySubtle: '#1e1b4b',
  success: '#22c55e',
  successMuted: '#14532d',
  warning: '#f59e0b',
  warningMuted: '#78350f',
  danger: '#ef4444',
  dangerMuted: '#7f1d1d',
  info: '#3b82f6',
  infoMuted: '#1e3a5f',
  presenceOnline: '#22c55e',
  presenceAway: '#f59e0b',
  presenceBusy: '#ef4444',
  presenceOffline: '#6b7280',
  verificationVerified: '#22c55e',
  verificationPartial: '#f59e0b',
  verificationNone: '#6b7280',
  overlay: 'rgba(0,0,0,0.5)',
  shadow: '#000',
  focus: '#6366f1',
  skeleton: '#333',
  skeletonShimmer: '#444',
  editorCanvas: '#1a1a2e',
  tooltipBg: '#222',
  onTooltip: '#fff',
};

const mockTheme: Theme = {
  scheme: 'dark',
  colors: mockPalette,
  spacing: { '0': 0, '1': 4, '2': 8, '3': 12, '4': 16 },
  radii: { sm: 4, md: 8, lg: 16, full: 9999 },
  type: {},
  fonts: {},
  motion: {},
  shadows: {},
  layout: {},
  opacity: { disabled: 0.5 },
  swatches: { blue: '#3b82f6', green: '#22c55e', red: '#ef4444' },
  layers: { modal: 100, tooltip: 200 },
  easing: { standard: [0.4, 0, 0.2, 1] },
  labelTracking: {},
};

describe('presenceColor', () => {
  it('maps online → presenceOnline', () => {
    expect(presenceColor(mockPalette, 'online')).toBe(mockPalette.presenceOnline);
  });
  it('maps away → presenceAway', () => {
    expect(presenceColor(mockPalette, 'away')).toBe(mockPalette.presenceAway);
  });
  it('maps busy → presenceBusy', () => {
    expect(presenceColor(mockPalette, 'busy')).toBe(mockPalette.presenceBusy);
  });
  it('falls back to offline for unknown status', () => {
    expect(presenceColor(mockPalette, 'unknown')).toBe(mockPalette.presenceOffline);
  });
});

describe('verificationColor', () => {
  it('maps verified', () => {
    expect(verificationColor(mockPalette, 'verified')).toBe(mockPalette.verificationVerified);
  });
  it('maps partial', () => {
    expect(verificationColor(mockPalette, 'partial')).toBe(mockPalette.verificationPartial);
  });
  it('falls back to none', () => {
    expect(verificationColor(mockPalette, 'unknown')).toBe(mockPalette.verificationNone);
  });
});

describe('avatarTint', () => {
  it('returns a string color', () => {
    expect(typeof avatarTint(mockPalette, 'user123')).toBe('string');
  });
  it('is stable for the same userId', () => {
    expect(avatarTint(mockPalette, 'alice')).toBe(avatarTint(mockPalette, 'alice'));
  });
  it('differs for different userIds', () => {
    // Not guaranteed to differ, but very likely
    const colors = new Set(['alice', 'bob', 'carol', 'dave', 'eve'].map(u => avatarTint(mockPalette, u)));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('swatch', () => {
  it('returns the named swatch', () => {
    expect(swatch(mockTheme, 'blue')).toBe('#3b82f6');
  });
  it('falls back to primary for unknown swatch', () => {
    expect(swatch(mockTheme, 'nonexistent')).toBe(mockPalette.primary);
  });
});

describe('paperBorder', () => {
  it('returns borderSubtle', () => {
    expect(paperBorder(mockPalette)).toBe(mockPalette.borderSubtle);
  });
});

describe('glowShadow', () => {
  it('returns a shadow token with the given color', () => {
    const shadow = glowShadow('#6366f1');
    expect(shadow.shadowColor).toBe('#6366f1');
    expect(typeof shadow.shadowRadius).toBe('number');
  });
  it('respects custom radius and opacity', () => {
    const shadow = glowShadow('#fff', 12, 0.6);
    expect(shadow.shadowRadius).toBe(12);
    expect(shadow.shadowOpacity).toBe(0.6);
  });
});

describe('focusRingStyle', () => {
  it('returns an object with borderColor matching palette.focus', () => {
    const ring = focusRingStyle(mockPalette);
    expect(ring.borderColor).toBe(mockPalette.focus);
    expect(ring.borderStyle).toBe('solid');
    expect(ring.borderWidth).toBe(2);
  });
  it('respects custom width', () => {
    expect(focusRingStyle(mockPalette, 3).borderWidth).toBe(3);
  });
});

describe('statusColor', () => {
  it('returns success color', () => {
    expect(statusColor(mockPalette, 'success')).toBe(mockPalette.success);
  });
  it('returns muted variant when muted=true', () => {
    expect(statusColor(mockPalette, 'danger', true)).toBe(mockPalette.dangerMuted);
  });
  it('falls back to info for unknown status', () => {
    expect(statusColor(mockPalette, 'unknown')).toBe(mockPalette.info);
  });
});
