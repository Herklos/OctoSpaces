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
import React, { useState } from 'react';
import {
  Pressable as RNPressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { PressableProps, View as RNView } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { railTileState } from './tile-state.js';
import type { RailTileTokens } from './tile-state.js';
import type { RailIconName, RailSpace } from './types.js';

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
  /** When provided, renders a leading DM-home tile. */
  onSelectDms?: () => void;
  /** Whether the DM-home tile is the active selection. */
  dmsActive?: boolean;
  /** Unread count for the DM-home tile badge. */
  dmUnread?: number;
  /** Accessibility label for the DM-home tile (default: "Direct messages"). */
  dmLabel?: string;
  /** Accessibility label for the add-space tile (default: "Create or join a space"). */
  addLabel?: string;
  /**
   * Render a named icon at the given size and color. Used for the DM tile icon
   * (`'dm'`), the E2EE lock corner (`'lock'`), the mute corner (`'mute'`),
   * and the add tile icon (`'add'`). Return `null` to suppress the icon slot.
   * If omitted, all icon slots render nothing.
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

function TileContent({
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
}

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

function PlainTile({
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
}

// ── DndTile — space tile with hook-injected DnD ref + over state ──────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any

interface DndTileProps extends TileSharedProps {
  /** Hook injection: called unconditionally at the top of this component.
   *  Treat it as a React hook — always provided for every DndTile. */
  dnd: NonNullable<SpacesRailProps['useTileDnd']>;
}

function DndTile({
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
}

// ── SpacesRail ─────────────────────────────────────────────────────────────────

/**
 * Vertical spaces rail — a 64px-wide column of square space tiles, a DM-home tile,
 * an add-space tile, and a pinned foot for the account widget.
 *
 * Styled entirely from the injected {@link Theme} via `useOctoSpacesTheme()`.
 * All icons, images, badges, and the account foot are provided by the host app.
 */
export function SpacesRail({
  spaces,
  activeId,
  onSelect,
  onAdd,
  onSelectDms,
  dmsActive = false,
  dmUnread,
  dmLabel = 'Direct messages',
  addLabel = 'Create or join a space',
  renderIcon,
  renderTileImage,
  renderBadge,
  showLockCorner = false,
  renderFoot,
  useTileDnd,
}: SpacesRailProps) {
  const theme = useOctoSpacesTheme();
  const { colors, spacing, radii, type: typeScale, fonts, layout } = theme;

  const tokens = resolveRailTokens(theme);

  // Layout constants with fallbacks for hosts that haven't set them.
  const railWidth = (layout['railWidth'] as number | undefined) ?? 64;
  const spaceV = (spacing['2'] as number | undefined) ?? 8;
  const spaceXs = (spacing['1'] as number | undefined) ?? 4;
  const spaceS = (spacing['2'] as number | undefined) ?? 8;
  const spaceMd = (spacing['3'] as number | undefined) ?? 12;

  const radiusActive = (radii['lg'] as number | undefined) ?? 12;
  const radiusDefault = (radii['xl'] as number | undefined) ?? 16;

  const footnoteSize = typeScale['footnote']?.size ?? 12;
  const footnoteLineH = typeScale['footnote']?.lineHeight ?? 18;
  const monoFont = fonts['mono'] ?? undefined;

  // Corner-badge tokens (background = rail surface, border = rail border).
  const cornerBg = colors.sidebar;
  const cornerBorder = colors.border;

  // Shared tile props (passed to every tile variant).
  const tileShared = {
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
  };

  // DM tile hover state (managed here since DM tile is inline, not a separate component).
  const [dmHovered, setDmHovered] = useState(false);

  const dmTileStyle = railTileState(
    { active: dmsActive, hovered: dmHovered, over: false },
    tokens,
    radiusActive,
    radiusDefault,
  );

  const dmIconColor = dmsActive ? colors.textOnPrimary : dmHovered ? tokens.railTileHoverInk : colors.textSecondary;

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
        {/* DM-home tile (pinned first when provided) */}
        {onSelectDms ? (
          <View style={{ position: 'relative' }}>
            <Pressable
              onPress={onSelectDms}
              onMouseEnter={() => setDmHovered(true)}
              onMouseLeave={() => setDmHovered(false)}
              accessibilityRole="button"
              accessibilityLabel={dmLabel}
              style={{
                width: TILE_SIZE,
                height: TILE_SIZE,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: dmTileStyle.radius,
                backgroundColor: dmTileStyle.bg,
                borderWidth: dmTileStyle.borderWidth,
                borderColor: dmTileStyle.borderColor,
                ...(dmTileStyle.shadow ?? {}),
              }}
            >
              {renderIcon ? renderIcon('dm', 20, dmIconColor) : null}
            </Pressable>
            {/* Lock corner */}
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
            {/* DM unread badge */}
            {dmUnread ? (
              <View style={{ position: 'absolute', top: BADGE_OFFSET, right: BADGE_OFFSET }}>
                {renderBadge ? renderBadge(dmUnread) : null}
              </View>
            ) : null}
          </View>
        ) : null}

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
