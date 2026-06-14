import { describe, it, expect } from 'vitest';
import { railTileState } from './tile-state.js';
import type { RailTileTokens } from './tile-state.js';

// ── Shared fixtures ────────────────────────────────────────────────────────────

const tokens: RailTileTokens = {
  primary: '#0e7090',
  primaryMuted: '#e0f2f8',
  primarySubtle: '#cce9f3',
  surfaceInput: '#f0f4f6',
  borderSubtle: '#d1dde3',
  textOnPrimary: '#ffffff',
  textSecondary: '#5c7080',
  textTertiary: '#8a9daa',
  railTile: '#e8edf0',
  railTileHoverBorder: '#90c8da',
  railGlow: '#5bc8e2',
  railTileHoverInk: '#0e7090',
};

const RADIUS_ACTIVE = 12;
const RADIUS_DEFAULT = 16;

// ── railTileState ──────────────────────────────────────────────────────────────

describe('railTileState — active tile', () => {
  it('uses primary bg with no border', () => {
    const style = railTileState({ active: true, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.bg).toBe(tokens.primary);
    expect(style.borderWidth).toBe(0);
    expect(style.borderColor).toBe('transparent');
  });

  it('uses textOnPrimary label color', () => {
    const style = railTileState({ active: true, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.labelColor).toBe(tokens.textOnPrimary);
  });

  it('applies a glow shadow', () => {
    const style = railTileState({ active: true, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.shadow).not.toBeNull();
    expect(style.shadow!.shadowColor).toBe(tokens.railGlow);
  });

  it('uses the active (smaller) radius', () => {
    const style = railTileState({ active: true, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.radius).toBe(RADIUS_ACTIVE);
  });
});

describe('railTileState — hovered tile (not active)', () => {
  it('uses primaryMuted bg', () => {
    const style = railTileState({ active: false, hovered: true, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.bg).toBe(tokens.primaryMuted);
  });

  it('uses railTileHoverBorder as border color', () => {
    const style = railTileState({ active: false, hovered: true, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.borderColor).toBe(tokens.railTileHoverBorder);
    expect(style.borderWidth).toBe(1);
  });

  it('uses railTileHoverInk as label color', () => {
    const style = railTileState({ active: false, hovered: true, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.labelColor).toBe(tokens.railTileHoverInk);
  });

  it('uses the active (smaller) radius when hovered', () => {
    const style = railTileState({ active: false, hovered: true, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.radius).toBe(RADIUS_ACTIVE);
  });

  it('has no glow shadow', () => {
    const style = railTileState({ active: false, hovered: true, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.shadow).toBeNull();
  });
});

describe('railTileState — resting tile (not active, not hovered)', () => {
  it('uses railTile bg token', () => {
    const style = railTileState({ active: false, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.bg).toBe(tokens.railTile);
  });

  it('uses borderSubtle and borderWidth 1', () => {
    const style = railTileState({ active: false, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.borderColor).toBe(tokens.borderSubtle);
    expect(style.borderWidth).toBe(1);
  });

  it('uses textSecondary label color', () => {
    const style = railTileState({ active: false, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.labelColor).toBe(tokens.textSecondary);
  });

  it('uses the default (larger) radius', () => {
    const style = railTileState({ active: false, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.radius).toBe(RADIUS_DEFAULT);
  });

  it('has no glow shadow', () => {
    const style = railTileState({ active: false, hovered: false, over: false }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.shadow).toBeNull();
  });
});

describe('railTileState — drop-over state (DnD target)', () => {
  it('shows primary border when another tile is dragged over (not active)', () => {
    const style = railTileState({ active: false, hovered: false, over: true }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.borderColor).toBe(tokens.primary);
    expect(style.borderWidth).toBe(1);
  });

  it('uses the active radius when over', () => {
    const style = railTileState({ active: false, hovered: false, over: true }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(style.radius).toBe(RADIUS_ACTIVE);
  });

  it('does NOT override border when tile is active (active wins)', () => {
    const style = railTileState({ active: true, hovered: false, over: true }, tokens, RADIUS_ACTIVE, RADIUS_DEFAULT);
    // Active tile keeps its no-border style even when over
    expect(style.borderWidth).toBe(0);
    expect(style.borderColor).toBe('transparent');
  });
});
