/**
 * Headless, abstractly-themed vertical spaces rail.
 *
 * The component reads the injected {@link Theme} via `useOctoSpacesTheme()` and
 * delegates all app-specific concerns to props:
 *
 * - Icons are rendered by `renderIcon` (keeps `@expo/vector-icons` out of this package).
 * - Space tile images are rendered by `renderTileImage` (keeps `expo-image` out too).
 * - Unread badges are rendered by `renderBadge`.
 * - The rail foot (account avatar + menu) is rendered by `renderFoot`.
 * - Web drag-reorder is wired via the `useTileDnd` hook prop (see below).
 *
 * All React Native primitives used here ship with the `react-native` peer dep.
 */
import React, { useMemo, useState } from 'react';
import {
  Pressable as RNPressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { PressableProps, View as RNView } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';
import { railTileState } from './tile-state.js';
import type { RailTileTokens } from './tile-state.js';
import type { RailIconName, RailSpace, RailSpecialTile } from './types.js';

// ── Pressable with web hover events ───────────────────────────────────────────

// React Native Web supports onMouseEnter/onMouseLeave for hover detection.
// The peer dep is >=0.75 which includes these events in the ViewProps contract.
// Cast to ForwardRefExoticComponent so `ref` is a valid JSX prop (Pressable
// already uses forwardRef internally; this just makes TypeScript aware of it).
type HoverProps = { onMouseEnter?: () => void; onMouseLeave?: () => void };
const Pressable = RNPressable as React.ForwardRefExoticComponent<
  PressableProps & HoverProps & React.RefAttributes<RNView>
>;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SpacesRailProps {
  /** The spaces to show in the scrollable column. */
  spaces: RailSpace[];
  /** The currently-active space id (or null / undefined for none). */
  activeId?: string | null;
  /** Called when the user selects a space tile. */
  onSelect?: (id: string) => void;
  /** Called when the user taps the "add" tile. */
  onAdd?: () => void;
  /**
   * Special tiles pinned above the space tiles (Notes, DMs, Inbox, …).
   * Rendered in array order before the scrollable space tiles.
   */
  specialTiles?: RailSpecialTile[];
  /** Accessibility label for the add-space tile (default: "Create or join a space"). */
  addLabel?: string;
  /**
   * Render a named icon at the given size and color. Used for special tile icons
   * (`'dm'`, `'notes'`, …), the E2EE lock corner (`'lock'`), the mute corner
   * (`'mute'`), and the add tile icon (`'add'`). Return `null` to suppress the
   * icon slot. If omitted, all icon slots render nothing.
   */
  renderIcon?: (name: RailIconName, size: number, color: string) => React.ReactNode;
  /**
   * Render an image filling the tile background. Only called when `space.image`
   * is set. The component must fill its parent (`StyleSheet.absoluteFill` or
   * equivalent). If omitted, the short-name monogram is shown instead.
   */
  renderTileImage?: (space: RailSpace) => React.ReactNode;
  /**
   * Render an unread badge. Only called when `space.unread > 0`.
   * If omitted, badges are not shown.
   */
  renderBadge?: (count: number) => React.ReactNode;
  /**
   * When `true`, each tile shows a small E2EE-lock corner badge (bottom-right).
   * Requires `renderIcon` to be provided (otherwise the corner renders nothing).
   * Default: `false`.
   */
  showLockCorner?: boolean;
  /**
   * Render the pinned rail foot (e.g. the account avatar and popover).
   * The host app owns this entirely — identity state stays out of the package.
   */
  renderFoot?: () => React.ReactNode;
  /**
   * **Hook injection for web drag-reorder.** When provided, each space tile is
   * wrapped in a `DndTile` that calls `useTileDnd(spaceId)` unconditionally at
   * the top of its render — treat this prop as a React hook and keep it stable
   * for the lifetime of a `SpacesRail` mount (always provided or always absent).
   * Omit on native / in apps that don't need DnD.
   */
  useTileDnd?: (spaceId: string) => { ref?: React.Ref<RNView>; over?: boolean };
}

// ── Token resolver ─────────────────────────────────────────────────────────────

function resolveRailTokens(theme: ReturnType<typeof useOctoSpacesTheme>): RailTileTokens {
  const { colors, swatches } = theme;
  return {
    primary: colors.primary,
    primaryMuted: colors.primaryMuted,
    primarySubtle: colors.primarySubtle,
    surfaceInput: colors.surfaceInput,
    borderSubtle: colors.borderSubtle,
    textOnPrimary: colors.textOnPrimary,
    textSecondary: colors.textSecondary,
    textTertiary: colors.textTertiary,
    railTile: swatches['railTile'] ?? colors.surfaceInput,
    railTileHoverBorder: swatches['railTileHoverBorder'] ?? colors.primarySubtle,
    railGlow: swatches['railGlow'] ?? colors.primary,
    railTileHoverInk: swatches['railTileHoverInk'] ?? colors.primary,
  };
}

// ── Shared tile dimensions (constant) ────────────────────────────────────────

const TILE_SIZE = 40;
const CORNER_SIZE = 16;
const BADGE_OFFSET = -5;
const CORNER_OFFSET = -3;

// ── Tile content (non-hook render helper) ─────────────────────────────────────

interface TileContentProps {
  space: RailSpace;
  labelColor: string;
  fontFamily?: string;
  fontSize: number;
  lineHeight: number;
  cornerBg: string;
  cornerBorder: string;
  cornerIconColor: string;
  renderIcon?: SpacesRailProps['renderIcon'];
  renderTileImage?: SpacesRailProps['renderTileImage'];
  renderBadge?: SpacesRailProps['renderBadge'];
  showLockCorner?: boolean;
}

const TileContent = React.memo(function TileContent({
  space,
  labelColor,
  fontFamily,
  fontSize,
  lineHeight,
  cornerBg,
  cornerBorder,
  cornerIconColor,
  renderIcon,
  renderTileImage,
  renderBadge,
  showLockCorner,
}: TileContentProps) {
  return (
    <>
      {/* Image or monogram */}
      {space.image && renderTileImage ? (
        renderTileImage(space)
      ) : (
        <Text
          style={{
            fontSize,
            lineHeight,
            fontWeight: '700',
            fontFamily: fontFamily ?? undefined,
            color: labelColor,
          }}
          numberOfLines={1}
        >
          {space.short}
        </Text>
      )}
      {/* E2EE lock corner (bottom-right) */}
      {showLockCorner && renderIcon ? (
        <View
          style={{
            position: 'absolute',
            bottom: CORNER_OFFSET,
            right: CORNER_OFFSET,
            width: CORNER_SIZE,
            height: CORNER_SIZE,
            borderRadius: CORNER_SIZE / 2,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: cornerBg,
            borderColor: cornerBorder,
          }}
        >
          {renderIcon('lock', 9, cornerIconColor)}
        </View>
      ) : null}
      {/* Mute corner (bottom-left) */}
      {space.muted && renderIcon ? (
        <View
          style={{
            position: 'absolute',
            bottom: CORNER_OFFSET,
            left: CORNER_OFFSET,
            width: CORNER_SIZE,
            height: CORNER_SIZE,
            borderRadius: CORNER_SIZE / 2,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: cornerBg,
            borderColor: cornerBorder,
          }}
        >
          {renderIcon('mute', 9, cornerIconColor)}
        </View>
      ) : null}
      {/* Unread badge (top-right) */}
      {space.unread ? (
        <View
          style={{
            position: 'absolute',
            top: BADGE_OFFSET,
            right: BADGE_OFFSET,
          }}
        >
          {renderBadge ? renderBadge(space.unread) : null}
        </View>
      ) : null}
    </>
  );
});

// ── PlainTile — space tile without DnD ────────────────────────────────────────

interface TileSharedProps {
  space: RailSpace;
  active: boolean;
  onPress?: () => void;
  tokens: RailTileTokens;
  radiusActive: number;
  radiusDefault: number;
  renderIcon?: SpacesRailProps['renderIcon'];
  renderTileImage?: SpacesRailProps['renderTileImage'];
  renderBadge?: SpacesRailProps['renderBadge'];
  showLockCorner?: boolean;
  cornerBg: string;
  cornerBorder: string;
  fontFamily?: string;
  fontSize: number;
  lineHeight: number;
}

const PlainTile = React.memo(function PlainTile({
  space,
  active,
  onPress,
  tokens,
  radiusActive,
  radiusDefault,
  renderIcon,
  renderTileImage,
  renderBadge,
  showLockCorner,
  cornerBg,
  cornerBorder,
  fontFamily,
  fontSize,
  lineHeight,
}: TileSharedProps) {
  const [hovered, setHovered] = useState(false);
  const s = railTileState({ active, hovered, over: false }, tokens, radiusActive, radiusDefault);

  return (
    <Pressable
      onPress={onPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={space.short}
      style={{
        position: 'relative',
        width: TILE_SIZE,
        height: TILE_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: s.radius,
        backgroundColor: s.bg,
        borderWidth: s.borderWidth,
        borderColor: s.borderColor,
        ...(s.shadow ?? {}),
      }}
    >
      <TileContent
        space={space}
        labelColor={s.labelColor}
        fontFamily={fontFamily}
        fontSize={fontSize}
        lineHeight={lineHeight}
        cornerBg={cornerBg}
        cornerBorder={cornerBorder}
        cornerIconColor={tokens.textTertiary}
        renderIcon={renderIcon}
        renderTileImage={renderTileImage}
        renderBadge={renderBadge}
        showLockCorner={showLockCorner}
      />
    </Pressable>
  );
});

// ── DndTile — space tile with hook-injected DnD ref + over state ──────────────

interface DndTileProps extends TileSharedProps {
  /** Hook injection: called unconditionally at the top of this component.
   *  Treat it as a React hook — always provided for every DndTile. */
  dnd: NonNullable<SpacesRailProps['useTileDnd']>;
}

const DndTile = React.memo(function DndTile({
  space,
  active,
  onPress,
  tokens,
  radiusActive,
  radiusDefault,
  renderIcon,
  renderTileImage,
  renderBadge,
  showLockCorner,
  cornerBg,
  cornerBorder,
  fontFamily,
  fontSize,
  lineHeight,
  dnd,
}: DndTileProps) {
  const [hovered, setHovered] = useState(false);
  // Hook injection: useTileDnd is called unconditionally here (it IS a hook).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { ref, over = false } = dnd(space.id);
  const s = railTileState({ active, hovered, over }, tokens, radiusActive, radiusDefault);

  return (
    <Pressable
      ref={ref as React.Ref<RNView>}
      onPress={onPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={space.short}
      style={{
        position: 'relative',
        width: TILE_SIZE,
        height: TILE_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: s.radius,
        backgroundColor: s.bg,
        borderWidth: s.borderWidth,
        borderColor: s.borderColor,
        ...(s.shadow ?? {}),
      }}
    >
      <TileContent
        space={space}
        labelColor={s.labelColor}
        fontFamily={fontFamily}
        fontSize={fontSize}
        lineHeight={lineHeight}
        cornerBg={cornerBg}
        cornerBorder={cornerBorder}
        cornerIconColor={tokens.textTertiary}
        renderIcon={renderIcon}
        renderTileImage={renderTileImage}
        renderBadge={renderBadge}
        showLockCorner={showLockCorner}
      />
    </Pressable>
  );
});

// ── SpecialTile — a pinned non-space tile (Notes, DMs, …) ─────────────────────

interface SpecialTileProps {
  tile: RailSpecialTile;
  tokens: RailTileTokens;
  radiusActive: number;
  radiusDefault: number;
  showLockCorner?: boolean;
  cornerBg: string;
  cornerBorder: string;
  renderIcon?: SpacesRailProps['renderIcon'];
  renderBadge?: SpacesRailProps['renderBadge'];
}

const SpecialTile = React.memo(function SpecialTile({
  tile,
  tokens,
  radiusActive,
  radiusDefault,
  showLockCorner,
  cornerBg,
  cornerBorder,
  renderIcon,
  renderBadge,
}: SpecialTileProps) {
  const [hovered, setHovered] = useState(false);
  const s = railTileState(
    { active: tile.active ?? false, hovered, over: false },
    tokens,
    radiusActive,
    radiusDefault,
  );
  const iconColor = tile.active
    ? tokens.textOnPrimary
    : hovered
    ? tokens.railTileHoverInk
    : tokens.textSecondary;

  return (
    <View style={{ position: 'relative' }}>
      <Pressable
        onPress={tile.onPress}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={tile.label ?? tile.icon}
        style={{
          width: TILE_SIZE,
          height: TILE_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: s.radius,
          backgroundColor: s.bg,
          borderWidth: s.borderWidth,
          borderColor: s.borderColor,
          ...(s.shadow ?? {}),
        }}
      >
        {renderIcon ? renderIcon(tile.icon, 20, iconColor) : null}
      </Pressable>
      {/* Lock corner (bottom-right) */}
      {showLockCorner && renderIcon ? (
        <View
          style={{
            position: 'absolute',
            bottom: CORNER_OFFSET,
            right: CORNER_OFFSET,
            width: CORNER_SIZE,
            height: CORNER_SIZE,
            borderRadius: CORNER_SIZE / 2,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: cornerBg,
            borderColor: cornerBorder,
          }}
        >
          {renderIcon('lock', 9, tokens.textTertiary)}
        </View>
      ) : null}
      {/* Unread badge (top-right) */}
      {tile.unread ? (
        <View style={{ position: 'absolute', top: BADGE_OFFSET, right: BADGE_OFFSET }}>
          {renderBadge ? renderBadge(tile.unread) : null}
        </View>
      ) : null}
    </View>
  );
});

// ── SpacesRail ─────────────────────────────────────────────────────────────────

/**
 * Vertical spaces rail — a 64px-wide column of square space tiles, optional pinned
 * special tiles (Notes, DMs, …), an add-space tile, and a pinned foot for the
 * account widget.
 *
 * Styled entirely from the injected {@link Theme} via `useOctoSpacesTheme()`.
 * All icons, images, badges, and the account foot are provided by the host app.
 */
export function SpacesRail({
  spaces,
  activeId,
  onSelect,
  onAdd,
  specialTiles,
  addLabel = 'Create or join a space',
  renderIcon,
  renderTileImage,
  renderBadge,
  showLockCorner = false,
  renderFoot,
  useTileDnd,
}: SpacesRailProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();
  const { colors, type: typeScale, fonts } = theme;

  const tokens = resolveRailTokens(theme);

  // Layout constants with fallbacks for hosts that haven't set them.
  const railWidth = t.lay('railWidth');
  const spaceV = t.sp('2');
  const spaceXs = t.sp('1');
  const spaceS = t.sp('2');
  const spaceMd = t.sp('3');

  const radiusActive = t.rad('lg');
  const radiusDefault = t.rad('xl');

  const footnoteSize = typeScale['footnote']?.size ?? 12;
  const footnoteLineH = typeScale['footnote']?.lineHeight ?? 18;
  const monoFont = fonts['mono'] ?? undefined;

  // Corner-badge tokens (background = rail surface, border = rail border).
  const cornerBg = colors.sidebar;
  const cornerBorder = colors.border;

  // Shared tile props (passed to every tile variant). Memoized so tile components
  // that are wrapped in React.memo don't re-render when unrelated state changes.
  const tileShared = useMemo(() => ({
    tokens,
    radiusActive,
    radiusDefault,
    renderIcon,
    renderTileImage,
    renderBadge,
    showLockCorner,
    cornerBg,
    cornerBorder,
    fontFamily: monoFont,
    fontSize: footnoteSize,
    lineHeight: footnoteLineH,
  }), [tokens, radiusActive, radiusDefault, renderIcon, renderTileImage, renderBadge, showLockCorner, cornerBg, cornerBorder, monoFont, footnoteSize, footnoteLineH]);

  // Add-tile hover state.
  const [addHovered, setAddHovered] = useState(false);

  // Whether DnD is active (determines which tile variant to render).
  const hasDnd = !!useTileDnd;

  return (
    <View
      style={{
        width: railWidth,
        paddingVertical: spaceMd,
        borderRightWidth: 1,
        borderRightColor: colors.border,
        backgroundColor: colors.sidebar,
        alignItems: 'center',
        gap: spaceS,
      }}
    >
      {/* Scrollable tile column */}
      <ScrollView
        style={{ alignSelf: 'stretch', flex: 1 }}
        contentContainerStyle={{
          alignItems: 'center',
          gap: spaceV,
          paddingVertical: spaceXs,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Special tiles (Notes, DMs, …) pinned above the space tiles */}
        {specialTiles?.map((tile) => (
          <SpecialTile
            key={tile.key}
            tile={tile}
            tokens={tokens}
            radiusActive={radiusActive}
            radiusDefault={radiusDefault}
            showLockCorner={showLockCorner}
            cornerBg={cornerBg}
            cornerBorder={cornerBorder}
            renderIcon={renderIcon}
            renderBadge={renderBadge}
          />
        ))}

        {/* Space tiles */}
        {spaces.map((s) =>
          hasDnd ? (
            <DndTile
              key={s.id}
              space={s}
              active={s.id === activeId}
              onPress={() => onSelect?.(s.id)}
              dnd={useTileDnd!}
              {...tileShared}
            />
          ) : (
            <PlainTile
              key={s.id}
              space={s}
              active={s.id === activeId}
              onPress={() => onSelect?.(s.id)}
              {...tileShared}
            />
          ),
        )}

        {/* Add-space tile */}
        <Pressable
          onPress={onAdd}
          onMouseEnter={() => setAddHovered(true)}
          onMouseLeave={() => setAddHovered(false)}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          style={{
            width: TILE_SIZE,
            height: TILE_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radiusDefault,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: addHovered ? colors.border : colors.borderSubtle,
          }}
        >
          {renderIcon ? renderIcon('add', 16, addHovered ? tokens.railTileHoverInk : colors.textTertiary) : null}
        </Pressable>
      </ScrollView>

      {/* Pinned foot — account avatar, popover, etc. */}
      {renderFoot ? renderFoot() : null}
    </View>
  );
}
