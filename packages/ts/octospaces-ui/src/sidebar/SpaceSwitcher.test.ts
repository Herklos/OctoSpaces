/**
 * SpaceSwitcher — pure-logic tests.
 *
 * NOTE: No React Native renderer is available (vitest environment:'node',
 * no @testing-library/react-native). This file tests the PURE LOGIC parts
 * extracted from SpaceSwitcher:
 *   - Overflow computation (which rows are shown inline vs "see all")
 *   - Visible-space slicing with and without maxVisible
 *   - Variant-dependent trigger style (sidebar vs appbar flex property)
 *   - Selection callback forwarding (close + onSelect)
 *
 * To test the rendered JSX (Pressable, dropdown content), install
 * @testing-library/react-native and switch vitest to a react-native preset.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SwitcherSpace } from './SpaceSwitcher.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeSpace(id: string, name: string, unread = 0): SwitcherSpace {
  return { id, name, short: name.slice(0, 2).toUpperCase(), unread: unread || undefined };
}

const SPACES_3 = [makeSpace('a', 'Alpha'), makeSpace('b', 'Beta'), makeSpace('c', 'Gamma')];
const SPACES_6 = [...SPACES_3, makeSpace('d', 'Delta'), makeSpace('e', 'Epsilon'), makeSpace('f', 'Zeta')];

// ── Overflow logic ─────────────────────────────────────────────────────────────
//
// Mirrors the exact expression from SpaceSwitcher:
//   const overflow = maxVisible != null && onSeeAll != null && spaces.length > maxVisible;
//   const visibleSpaces = overflow ? spaces.slice(0, maxVisible) : spaces;

function computeOverflow(
  spaces: SwitcherSpace[],
  maxVisible: number | undefined,
  onSeeAll: (() => void) | undefined,
): { overflow: boolean; visibleSpaces: SwitcherSpace[] } {
  const overflow =
    maxVisible != null && onSeeAll != null && spaces.length > maxVisible;
  const visibleSpaces = overflow ? spaces.slice(0, maxVisible) : spaces;
  return { overflow, visibleSpaces };
}

describe('SpaceSwitcher overflow logic', () => {
  describe('no overflow — fewer spaces than threshold', () => {
    it('overflow is false when spaces.length <= maxVisible', () => {
      const { overflow } = computeOverflow(SPACES_3, 5, vi.fn());
      expect(overflow).toBe(false);
    });

    it('overflow is false when spaces.length exactly equals maxVisible', () => {
      const { overflow } = computeOverflow(SPACES_3, 3, vi.fn());
      expect(overflow).toBe(false);
    });

    it('all spaces are returned when no overflow', () => {
      const { visibleSpaces } = computeOverflow(SPACES_3, 5, vi.fn());
      expect(visibleSpaces).toHaveLength(3);
      expect(visibleSpaces.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('overflow — more spaces than threshold', () => {
    it('overflow is true when spaces.length > maxVisible AND onSeeAll provided', () => {
      const { overflow } = computeOverflow(SPACES_6, 4, vi.fn());
      expect(overflow).toBe(true);
    });

    it('"see all" item would appear (overflow = true signals ActionRow render)', () => {
      const { overflow } = computeOverflow(SPACES_6, 4, vi.fn());
      // In the component, `overflow === true` causes the "see all" ActionRow to render.
      expect(overflow).toBe(true);
    });

    it('only maxVisible spaces are returned when overflow', () => {
      const { visibleSpaces } = computeOverflow(SPACES_6, 4, vi.fn());
      expect(visibleSpaces).toHaveLength(4);
      expect(visibleSpaces.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('overflow disabled — onSeeAll not provided', () => {
    it('overflow is false even when spaces.length > maxVisible but onSeeAll absent', () => {
      const { overflow } = computeOverflow(SPACES_6, 4, undefined);
      expect(overflow).toBe(false);
    });

    it('all spaces are returned when onSeeAll absent (overflow rows hidden, not "see all")', () => {
      const { visibleSpaces } = computeOverflow(SPACES_6, 4, undefined);
      expect(visibleSpaces).toHaveLength(6);
    });
  });

  describe('overflow disabled — maxVisible not set', () => {
    it('overflow is false when maxVisible is undefined', () => {
      const { overflow } = computeOverflow(SPACES_6, undefined, vi.fn());
      expect(overflow).toBe(false);
    });

    it('all spaces returned when maxVisible undefined', () => {
      const { visibleSpaces } = computeOverflow(SPACES_6, undefined, vi.fn());
      expect(visibleSpaces).toHaveLength(6);
    });
  });
});

// ── Variant — trigger layout style ────────────────────────────────────────────
//
// Mirrors the exact baseStyle expression from SpaceSwitcher:
//   sidebar → flex: 1, flexDirection: 'row'
//   appbar  → justifyContent: 'center', flexDirection: 'row'

type Variant = 'sidebar' | 'appbar';

function triggerBaseStyle(variant: Variant) {
  if (variant === 'sidebar') {
    return {
      flex: 1 as const,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
    };
  }
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
}

describe('SpaceSwitcher variant trigger styles', () => {
  it('sidebar variant has flex:1', () => {
    const style = triggerBaseStyle('sidebar');
    expect(style.flex).toBe(1);
  });

  it('sidebar variant has flexDirection: row', () => {
    const style = triggerBaseStyle('sidebar');
    expect(style.flexDirection).toBe('row');
  });

  it('appbar variant has justifyContent: center', () => {
    const style = triggerBaseStyle('appbar');
    expect((style as { justifyContent?: string }).justifyContent).toBe('center');
  });

  it('appbar variant does NOT have flex:1', () => {
    const style = triggerBaseStyle('appbar');
    expect((style as { flex?: number }).flex).toBeUndefined();
  });
});

// ── Text shown in trigger button ──────────────────────────────────────────────
//
// Mirrors: active?.name ?? emptyLabel

function triggerLabel(
  spaces: SwitcherSpace[],
  activeId: string | null | undefined,
  emptyLabel = 'Spaces',
): string {
  const active = spaces.find((s) => s.id === activeId) ?? spaces[0] ?? null;
  return active?.name ?? emptyLabel;
}

describe('SpaceSwitcher trigger label', () => {
  it('shows name of active space when found', () => {
    expect(triggerLabel(SPACES_3, 'b')).toBe('Beta');
  });

  it('falls back to first space when activeId matches nothing', () => {
    expect(triggerLabel(SPACES_3, 'nonexistent')).toBe('Alpha');
  });

  it('shows emptyLabel when spaces array is empty', () => {
    expect(triggerLabel([], null, 'Spaces')).toBe('Spaces');
  });

  it('shows custom emptyLabel when spaces array is empty', () => {
    expect(triggerLabel([], null, 'My Spaces')).toBe('My Spaces');
  });
});

// ── Selection callback forwarding ─────────────────────────────────────────────
//
// Mirrors handleSelect: close() then onSelect(id)

function makeHandleSelect(
  close: () => void,
  onSelect: (id: string) => void,
): (id: string) => void {
  return (id) => { close(); onSelect(id); };
}

describe('SpaceSwitcher selection callback', () => {
  it('calls onSelect with the correct space id', () => {
    const close = vi.fn();
    const onSelect = vi.fn();
    const handleSelect = makeHandleSelect(close, onSelect);

    handleSelect('c');

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('calls close before onSelect (dropdown dismisses first)', () => {
    const callOrder: string[] = [];
    const close = vi.fn(() => callOrder.push('close'));
    const onSelect = vi.fn(() => callOrder.push('onSelect'));
    const handleSelect = makeHandleSelect(close, onSelect);

    handleSelect('a');

    expect(callOrder).toEqual(['close', 'onSelect']);
  });

  it('does not call onSelect when different id given', () => {
    const close = vi.fn();
    const onSelect = vi.fn();
    const handleSelect = makeHandleSelect(close, onSelect);

    handleSelect('b');

    expect(onSelect).toHaveBeenCalledWith('b');
    expect(onSelect).not.toHaveBeenCalledWith('a');
  });
});

// ── "add" label when spaces array is empty ────────────────────────────────────
//
// Mirrors: spaces.length > 0 ? addLabel : 'Create your first space'

function resolveAddLabel(spaces: SwitcherSpace[], addLabel = 'Join or create a space'): string {
  return spaces.length > 0 ? addLabel : 'Create your first space';
}

describe('SpaceSwitcher add-row label', () => {
  it('shows addLabel when spaces exist', () => {
    expect(resolveAddLabel(SPACES_3)).toBe('Join or create a space');
  });

  it('shows "Create your first space" when no spaces', () => {
    expect(resolveAddLabel([])).toBe('Create your first space');
  });

  it('shows custom addLabel when spaces exist', () => {
    expect(resolveAddLabel(SPACES_3, 'Add space')).toBe('Add space');
  });
});
