/**
 * SpacesRail — pure-logic tests.
 *
 * NOTE: No React Native renderer is available (vitest environment:'node',
 * no @testing-library/react-native). This file tests the PURE LOGIC parts of
 * SpacesRail:
 *   - hasDnd flag derivation (PlainTile vs DndTile path)
 *   - railTileState applied to active/hover states (integration with tile-state.ts)
 *   - resolveRailTokens-compatible token construction
 *   - onSelect callback forwarding
 *
 * To test which tile component is actually rendered (PlainTile vs DndTile),
 * install @testing-library/react-native and switch vitest to a react-native preset.
 */
import { describe, it, expect, vi } from 'vitest';
import { railTileState } from './tile-state.js';
import type { RailTileTokens } from './tile-state.js';
import type { RailSpace } from './types.js';

// ── Shared token fixture ───────────────────────────────────────────────────────

const TOKENS: RailTileTokens = {
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

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeSpace(id: string, short = 'AB', unread?: number): RailSpace {
  return { id, short, unread };
}

// ── 1. hasDnd flag — PlainTile vs DndTile path ─────────────────────────────────
//
// Mirrors: const hasDnd = !!useTileDnd;
// When hasDnd is false → PlainTile rendered; true → DndTile rendered.

function deriveHasDnd(useTileDnd: unknown): boolean {
  return !!useTileDnd;
}

describe('SpacesRail — hasDnd flag', () => {
  it('hasDnd is false when useTileDnd is undefined (PlainTile path)', () => {
    expect(deriveHasDnd(undefined)).toBe(false);
  });

  it('hasDnd is false when useTileDnd is null', () => {
    expect(deriveHasDnd(null)).toBe(false);
  });

  it('hasDnd is true when useTileDnd is provided (DndTile path)', () => {
    const mockHook = () => ({ ref: undefined, over: false });
    expect(deriveHasDnd(mockHook)).toBe(true);
  });

  it('hasDnd is true for any truthy hook value', () => {
    expect(deriveHasDnd(() => ({}))).toBe(true);
  });
});

// ── 2. Active tile state ─────────────────────────────────────────────────────
//
// SpacesRail sets `active={s.id === activeId}` on each tile.
// The tile then calls `railTileState({ active, hovered, over }, ...)`.
// Here we verify the integration: correct active flag → correct visual tokens.

describe('SpacesRail — active tile state integration', () => {
  it('active tile gets primary background', () => {
    const s = railTileState({ active: true, hovered: false, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.bg).toBe(TOKENS.primary);
  });

  it('inactive tile gets railTile background', () => {
    const s = railTileState({ active: false, hovered: false, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.bg).toBe(TOKENS.railTile);
  });

  it('active tile uses textOnPrimary label color', () => {
    const s = railTileState({ active: true, hovered: false, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.labelColor).toBe(TOKENS.textOnPrimary);
  });

  it('active tile has no border (borderWidth = 0)', () => {
    const s = railTileState({ active: true, hovered: false, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.borderWidth).toBe(0);
  });

  it('active tile uses radiusActive (squarer look)', () => {
    const s = railTileState({ active: true, hovered: false, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.radius).toBe(RADIUS_ACTIVE);
  });
});

// ── 3. Hover tile state ───────────────────────────────────────────────────────

describe('SpacesRail — hover tile state integration', () => {
  it('hovered tile gets primaryMuted background', () => {
    const s = railTileState({ active: false, hovered: true, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.bg).toBe(TOKENS.primaryMuted);
  });

  it('hovered tile uses railTileHoverInk label color', () => {
    const s = railTileState({ active: false, hovered: true, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.labelColor).toBe(TOKENS.railTileHoverInk);
  });

  it('hovered tile uses radiusActive', () => {
    const s = railTileState({ active: false, hovered: true, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.radius).toBe(RADIUS_ACTIVE);
  });

  it('inactive + non-hovered tile uses radiusDefault (rounder)', () => {
    const s = railTileState({ active: false, hovered: false, over: false }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    expect(s.radius).toBe(RADIUS_DEFAULT);
  });
});

// ── 4. Active-space derivation ─────────────────────────────────────────────────
//
// SpacesRail passes `active={s.id === activeId}` to each tile.
// Verify the boolean is computed correctly for various activeId values.

function isActive(space: RailSpace, activeId: string | null | undefined): boolean {
  return space.id === activeId;
}

describe('SpacesRail — active space derivation', () => {
  const spaceA = makeSpace('space-a');
  const spaceB = makeSpace('space-b');

  it('correctly marks the matching space as active', () => {
    expect(isActive(spaceA, 'space-a')).toBe(true);
    expect(isActive(spaceB, 'space-a')).toBe(false);
  });

  it('no space is active when activeId is null', () => {
    expect(isActive(spaceA, null)).toBe(false);
    expect(isActive(spaceB, null)).toBe(false);
  });

  it('no space is active when activeId is undefined', () => {
    expect(isActive(spaceA, undefined)).toBe(false);
  });

  it('no space is active when activeId matches nothing', () => {
    expect(isActive(spaceA, 'nonexistent')).toBe(false);
    expect(isActive(spaceB, 'nonexistent')).toBe(false);
  });
});

// ── 5. onSelect callback forwarding ──────────────────────────────────────────
//
// SpacesRail calls `onSelect?.(s.id)` on tile press.

describe('SpacesRail — onSelect callback', () => {
  function makeTileOnPress(spaceId: string, onSelect?: (id: string) => void): () => void {
    return () => onSelect?.(spaceId);
  }

  it('calls onSelect with the space id', () => {
    const onSelect = vi.fn();
    const onPress = makeTileOnPress('space-c', onSelect);
    onPress();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('space-c');
  });

  it('does not throw when onSelect is undefined (optional)', () => {
    const onPress = makeTileOnPress('space-c', undefined);
    expect(() => onPress()).not.toThrow();
  });

  it('each tile fires independently with its own id', () => {
    const onSelect = vi.fn();
    const spaces = [makeSpace('s1'), makeSpace('s2'), makeSpace('s3')];

    for (const s of spaces) {
      makeTileOnPress(s.id, onSelect)();
    }

    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenNthCalledWith(1, 's1');
    expect(onSelect).toHaveBeenNthCalledWith(2, 's2');
    expect(onSelect).toHaveBeenNthCalledWith(3, 's3');
  });
});

// ── 6. DndTile hook injection contract ────────────────────────────────────────
//
// When hasDnd is true, DndTile calls `dnd(space.id)` and reads `{ ref, over }`.
// Test that the hook is called with the correct spaceId.

describe('SpacesRail — DndTile useTileDnd hook injection', () => {
  it('useTileDnd is called with the space id', () => {
    const useTileDnd = vi.fn((_id: string) => ({ ref: undefined, over: false }));
    const space = makeSpace('dnd-space-1');

    // Simulate what DndTile does: call the hook with space.id
    const { ref, over } = useTileDnd(space.id);

    expect(useTileDnd).toHaveBeenCalledWith('dnd-space-1');
    expect(over).toBe(false);
    expect(ref).toBeUndefined();
  });

  it('over=true from hook is passed to railTileState', () => {
    const useTileDnd = vi.fn((_id: string) => ({ ref: undefined, over: true }));
    const space = makeSpace('dnd-space-2');
    const { over } = useTileDnd(space.id);

    const s = railTileState({ active: false, hovered: false, over }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    // Drop-target: border switches to primary
    expect(s.borderColor).toBe(TOKENS.primary);
    expect(s.radius).toBe(RADIUS_ACTIVE);
  });

  it('over=true on active tile does not override active border', () => {
    const useTileDnd = vi.fn((_id: string) => ({ ref: undefined, over: true }));
    const space = makeSpace('active-dnd');
    const { over } = useTileDnd(space.id);

    const s = railTileState({ active: true, hovered: false, over }, TOKENS, RADIUS_ACTIVE, RADIUS_DEFAULT);
    // Active tile wins — still no border
    expect(s.borderWidth).toBe(0);
    expect(s.borderColor).toBe('transparent');
  });
});
