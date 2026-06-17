/**
 * Headless themed space-switcher component.
 *
 * Renders a trigger button (active-space avatar + name + chevron) that opens a
 * dropdown listing all spaces with per-row selection (+ optional unread badges),
 * a "see all" overflow row, a "join or create" action, a "browse spaces" action,
 * optional space settings, and an app-provided footer slot (account section, etc.).
 *
 * The popup container (Popover on desktop, Sheet on mobile) is fully delegated to
 * the host via `renderContainer` so this package stays free of modal dependencies.
 * Avatars, icons and badges are delegated via render-props for the same reason.
 *
 * @example
 * ```tsx
 * // OctoVault — sidebar variant with Popover container
 * <SpaceSwitcher
 *   spaces={spaces}
 *   activeId={activeId}
 *   onSelect={switchSpace}
 *   onAdd={() => router.push('/join')}
 *   onSettings={() => router.push(`/space/${activeId}`)}
 *   variant="sidebar"
 *   renderTriggerAvatar={(space, size) => (
 *     <Avatar label={space?.short ?? ''} image={space?.image} size={size} />
 *   )}
 *   renderSpaceAvatar={(space, size) => (
 *     <Avatar label={space.short ?? ''} image={space.image} size={size} />
 *   )}
 *   renderIcon={(name, size, color) => <Icon name={SWITCHER_ICON[name]} size={size} color={color} />}
 *   renderContainer={({ isOpen, onClose, anchorRef, children }) => (
 *     <Popover visible={isOpen} onClose={onClose} anchorRef={anchorRef} placement="bottom-start" width={240}>
 *       {children}
 *     </Popover>
 *   )}
 *   footerSlot={(close) => <AccountSwitcher onRequestClose={close} onViewProfile={...} />}
 * />
 *
 * // OctoChat — appbar variant with bottom Sheet, overflow + badges
 * <SpaceSwitcher
 *   spaces={spaces}
 *   activeId={activeId}
 *   onSelect={(id) => { tapFeedback(); setActiveId(id); }}
 *   onAdd={() => router.push('/join')}
 *   onBrowse={() => router.push('/spaces/explore')}
 *   onSettings={() => router.push(`/space/${activeId}`)}
 *   maxVisible={5}
 *   onSeeAll={() => router.push('/spaces')}
 *   seeAllLabel="See all spaces"
 *   variant="appbar"
 *   renderTriggerAvatar={(space, size) => <Avatar label={space?.short ?? ''} image={space?.image} size={size} />}
 *   renderSpaceAvatar={(space, size) => <Avatar label={space.short ?? ''} image={space.image} size={size} />}
 *   renderIcon={(name, size, color) => <Icon name={SWITCHER_ICON[name]} size={size} color={color} />}
 *   renderBadge={(count) => <Badge count={count} />}
 *   renderTriggerBadge={() => <UnreadDot />}
 *   renderContainer={({ isOpen, onClose, children }) => (
 *     <BottomSheet visible={isOpen} onClose={onClose}>{children}</BottomSheet>
 *   )}
 *   footerSlot={(close) => <AccountSwitcher onRequestClose={close} onViewProfile={...} />}
 * />
 * ```
 */
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle, View as RNView } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';
import { HoverablePressable as Pressable } from '../primitives/hoverable-pressable.js';
import { interactionBg } from './interaction-bg.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Structural space item — no SDK dependency. */
export interface SwitcherSpace {
  id: string;
  name: string;
  /** 2-letter monogram used as avatar fallback. */
  short?: string;
  /** Uploaded space image URI; absent → host renders monogram. */
  image?: string;
  /** Unread message count displayed as a badge on the row. */
  unread?: number;
}

/** Icon name union for the switcher's built-in glyphs. */
export type SwitcherIconName =
  | 'chevron-down'
  | 'chevron-right'
  | 'check'
  | 'plus'
  | 'gear'
  | 'globe';

export interface SpaceSwitcherProps {
  spaces: SwitcherSpace[];
  activeId?: string | null;
  /** Called when the user taps a space row. */
  onSelect: (id: string) => void;

  /** "Join or create a space" action. Omit to hide the row. */
  onAdd?: () => void;
  /** Override the add-row label. @default "Join or create a space" */
  addLabel?: string;

  /** "Browse spaces" action (e.g. a public directory). Omit to hide the row. */
  onBrowse?: () => void;
  /** Override the browse-row label. @default "Browse spaces" */
  browseLabel?: string;

  /**
   * "Space settings" action. Only shown when both `onSettings` and `activeId`
   * are provided. Omit to hide.
   */
  onSettings?: () => void;
  /** Override the settings-row label. @default "Space settings" */
  settingsLabel?: string;

  /**
   * When set, limits how many space rows are rendered inline.
   * If `spaces.length > maxVisible` AND `onSeeAll` is also set, a "See all"
   * row is appended after the visible rows. Without `onSeeAll`, overflow rows
   * are simply hidden.
   */
  maxVisible?: number;
  /** Called when the user taps the "See all" overflow row. */
  onSeeAll?: () => void;
  /** Override the see-all-row label. @default "See all spaces" */
  seeAllLabel?: string;

  /**
   * Visual variant:
   * - `'sidebar'` — compact left-aligned trigger for the desktop sidebar header.
   * - `'appbar'` — centered trigger for a phone app-bar title area.
   */
  variant: 'sidebar' | 'appbar';

  /**
   * Wraps the dropdown content in the host app's container (Popover / Sheet).
   * Called with `{ isOpen, onClose, anchorRef, children }` — must render
   * children inside an appropriate modal surface.
   */
  renderContainer: (props: {
    isOpen: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<RNView>;
    children: React.ReactNode;
  }) => React.ReactNode;

  /**
   * Render the active-space avatar inside the trigger button.
   * Receives the active `SwitcherSpace` (or `null` when none) and a pixel size.
   * Omit to render nothing in the avatar slot.
   */
  renderTriggerAvatar?: (space: SwitcherSpace | null, size: number) => React.ReactNode;

  /**
   * Render an overlay node anchored top-right of the trigger avatar — used for
   * an "other spaces have unread" aggregate indicator. Omit to hide the overlay.
   */
  renderTriggerBadge?: () => React.ReactNode;

  /**
   * Render a space row's leading avatar.
   * Receives the `SwitcherSpace` and a pixel size.
   * Omit to render nothing in the leading slot.
   */
  renderSpaceAvatar?: (space: SwitcherSpace, size: number) => React.ReactNode;

  /**
   * Render an icon glyph. Name is one of the `SwitcherIconName` union values.
   * Omit to hide chevron, check, and action icons (spaces remain selectable).
   */
  renderIcon?: (name: SwitcherIconName, size: number, color: string) => React.ReactNode;

  /**
   * Render an unread-count badge on a space row.
   * Receives the count (always > 0 when called). Omit to hide badges.
   */
  renderBadge?: (count: number) => React.ReactNode;

  /**
   * Footer rendered below the space list + action rows — use for account-switcher
   * sections. Receives `close` so the account section can dismiss the dropdown after
   * an action (e.g. `<AccountSwitcher onRequestClose={close} />`). Fully app-owned.
   */
  footerSlot?: (close: () => void) => React.ReactNode;

  /**
   * Trigger label shown when there is no active space (i.e. `spaces` is empty and
   * `activeId` matches nothing). Also used as the `accessibilityLabel` suffix in the
   * no-space state. @default 'Spaces'
   */
  emptyLabel?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SpaceSwitcher({
  spaces,
  activeId,
  onSelect,
  onAdd,
  addLabel = 'Join or create a space',
  onBrowse,
  browseLabel = 'Browse spaces',
  onSettings,
  settingsLabel = 'Space settings',
  maxVisible,
  onSeeAll,
  seeAllLabel = 'See all spaces',
  variant,
  renderContainer,
  renderTriggerAvatar,
  renderTriggerBadge,
  renderSpaceAvatar,
  renderIcon,
  renderBadge,
  footerSlot,
  emptyLabel = 'Spaces',
}: SpaceSwitcherProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();
  const { colors, type: typeScale, fonts } = theme;

  const [open, setOpen] = useState(false);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const anchorRef = useRef<RNView>(null);

  const active = spaces.find((s) => s.id === activeId) ?? spaces[0] ?? null;

  const close = () => setOpen(false);
  const handleSelect = (id: string) => { close(); onSelect(id); };
  const handleAdd    = () => { close(); onAdd?.(); };
  const handleBrowse = () => { close(); onBrowse?.(); };
  const handleSettings = () => { close(); onSettings?.(); };
  const handleSeeAll   = () => { close(); onSeeAll?.(); };

  // ── spacing lookups ──────────────────────────────────────────────────────
  const sp1  = t.sp('1');
  const sp2  = t.sp('2');
  const sp3  = t.sp('3');
  const sp4  = t.sp('4');
  const radMd = t.rad('md');

  const bodyFont  = fonts['body'] ?? undefined;
  const bodySize  = typeScale['callout']?.size ?? 13;
  const bodyLine  = typeScale['callout']?.lineHeight ?? 18;
  const labelSize = typeScale['caption']?.size ?? 11;
  const labelLine = typeScale['caption']?.lineHeight ?? 16;

  // ── overflow: which rows to show inline ─────────────────────────────────
  const overflow =
    maxVisible != null && onSeeAll != null && spaces.length > maxVisible;
  const visibleSpaces = overflow ? spaces.slice(0, maxVisible) : spaces;

  // ── trigger style ────────────────────────────────────────────────────────
  const baseStyle =
    variant === 'sidebar'
      ? {
          flex: 1 as const,
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          gap: sp2,
          paddingHorizontal: sp2,
          paddingVertical: sp1 + 2,
          borderRadius: radMd,
          minWidth: 0,
        }
      : {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          gap: sp2,
          paddingHorizontal: sp2,
          paddingVertical: sp1,
          borderRadius: radMd,
        };

  // ── dropdown content ─────────────────────────────────────────────────────
  const dropdownContent = (
    <View style={{ paddingVertical: sp1 }}>
      {spaces.length > 0 ? (
        <SectionLabel
          label="Spaces"
          color={colors.textTertiary}
          size={labelSize}
          lineHeight={labelLine}
          font={bodyFont}
          paddingH={sp4}
          paddingV={sp1}
        />
      ) : null}

      {visibleSpaces.map((s) => (
        <SpaceRow
          key={s.id}
          space={s}
          active={s.id === (active?.id ?? null)}
          onPress={() => handleSelect(s.id)}
          renderAvatar={renderSpaceAvatar}
          renderIcon={renderIcon}
          renderBadge={renderBadge}
          colors={colors}
          bodyFont={bodyFont}
          bodySize={bodySize}
          bodyLine={bodyLine}
          sp2={sp2}
          sp3={sp3}
          sp4={sp4}
          radMd={radMd}
        />
      ))}

      {overflow ? (
        <ActionRow
          label={seeAllLabel}
          iconName="chevron-right"
          onPress={handleSeeAll}
          renderIcon={renderIcon}
          colors={colors}
          bodyFont={bodyFont}
          bodySize={bodySize}
          bodyLine={bodyLine}
          sp2={sp2}
          sp3={sp3}
          sp4={sp4}
          radMd={radMd}
        />
      ) : null}

      {onAdd ? (
        <ActionRow
          label={spaces.length > 0 ? addLabel : 'Create your first space'}
          iconName="plus"
          onPress={handleAdd}
          renderIcon={renderIcon}
          colors={colors}
          bodyFont={bodyFont}
          bodySize={bodySize}
          bodyLine={bodyLine}
          sp2={sp2}
          sp3={sp3}
          sp4={sp4}
          radMd={radMd}
        />
      ) : null}

      {onBrowse ? (
        <ActionRow
          label={browseLabel}
          iconName="globe"
          onPress={handleBrowse}
          renderIcon={renderIcon}
          colors={colors}
          bodyFont={bodyFont}
          bodySize={bodySize}
          bodyLine={bodyLine}
          sp2={sp2}
          sp3={sp3}
          sp4={sp4}
          radMd={radMd}
        />
      ) : null}

      {onSettings && active ? (
        <ActionRow
          label={settingsLabel}
          iconName="gear"
          onPress={handleSettings}
          renderIcon={renderIcon}
          colors={colors}
          bodyFont={bodyFont}
          bodySize={bodySize}
          bodyLine={bodyLine}
          sp2={sp2}
          sp3={sp3}
          sp4={sp4}
          radMd={radMd}
        />
      ) : null}

      {footerSlot != null ? (
        <>
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: colors.borderSubtle,
              marginVertical: sp1,
              marginHorizontal: sp2,
            }}
          />
          {footerSlot(close)}
        </>
      ) : null}
    </View>
  );

  return (
    <>
      <Pressable
        ref={anchorRef}
        accessibilityRole="button"
        accessibilityLabel={active ? `${active.name} — switch space` : `${emptyLabel} — switch space`}
        accessibilityState={{ expanded: open }}
        hitSlop={6}
        onPress={() => setOpen(true)}
        onMouseEnter={() => setTriggerHovered(true)}
        onMouseLeave={() => setTriggerHovered(false)}
        style={({ pressed }) => [
          baseStyle,
          {
            backgroundColor: interactionBg(
              { pressed, hovered: triggerHovered },
              { pressed: colors.primarySubtle, hovered: colors.primarySubtle },
            ),
          },
        ]}
      >
        {renderTriggerAvatar != null || renderTriggerBadge != null ? (
          <View style={styles.avatarWrap}>
            {renderTriggerAvatar ? renderTriggerAvatar(active, 22) : null}
            {renderTriggerBadge ? (
              <View style={styles.triggerBadge}>{renderTriggerBadge()}</View>
            ) : null}
          </View>
        ) : null}
        <Text
          numberOfLines={1}
          style={
            {
              flex: variant === 'sidebar' ? 1 : undefined,
              minWidth: 0,
              flexShrink: 1,
              fontSize: t.type('heading').size,
              lineHeight: t.type('heading').lineHeight,
              fontWeight: '600',
              color: colors.text,
              fontFamily: bodyFont,
            } as TextStyle
          }
        >
          {active?.name ?? emptyLabel}
        </Text>
        {renderIcon ? renderIcon('chevron-down', 14, colors.textTertiary) : null}
      </Pressable>

      {renderContainer({ isOpen: open, onClose: close, anchorRef, children: dropdownContent })}
    </>
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  avatarWrap: { position: 'relative' },
  triggerBadge: { position: 'absolute', top: -2, right: -2 },
});

interface SectionLabelProps {
  label: string;
  color: string;
  size: number;
  lineHeight: number;
  font: string | undefined;
  paddingH: number;
  paddingV: number;
}

function SectionLabel({ label, color, size, lineHeight, font, paddingH, paddingV }: SectionLabelProps) {
  return (
    <Text
      style={
        {
          fontSize: size,
          lineHeight,
          fontWeight: '600',
          color,
          fontFamily: font,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          paddingHorizontal: paddingH,
          paddingVertical: paddingV,
        } as TextStyle
      }
    >
      {label}
    </Text>
  );
}

// Shared dropdown-row shell for SpaceRow and ActionRow — identical Pressable +
// label layout; the variations are the leading/trailing slots and label styling.
interface MenuRowStyleTokens {
  colors: ReturnType<typeof useOctoSpacesTheme>['colors'];
  bodyFont: string | undefined;
  bodySize: number;
  bodyLine: number;
  sp2: number;
  sp3: number;
  sp4: number;
  radMd: number;
}

interface MenuRowProps extends MenuRowStyleTokens {
  accessibilityLabel: string;
  accessibilityState?: { selected?: boolean };
  onPress: () => void;
  leading?: React.ReactNode;
  label: string;
  labelColor: string;
  labelWeight: TextStyle['fontWeight'];
  trailing?: React.ReactNode;
}

function MenuRow({
  accessibilityLabel,
  accessibilityState,
  onPress,
  leading,
  label,
  labelColor,
  labelWeight,
  trailing,
  colors,
  bodyFont,
  bodySize,
  bodyLine,
  sp2,
  sp3,
  sp4,
  radMd,
}: MenuRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={accessibilityLabel}
      {...(accessibilityState ? { accessibilityState } : {})}
      onPress={onPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={({ pressed }) => ({
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: sp3,
        paddingHorizontal: sp4,
        paddingVertical: sp2,
        borderRadius: radMd,
        backgroundColor: interactionBg(
          { pressed, hovered },
          { pressed: colors.primarySubtle, hovered: colors.primarySubtle },
        ),
      })}
    >
      {leading}
      <Text
        numberOfLines={1}
        style={
          {
            flex: 1,
            minWidth: 0,
            fontSize: bodySize,
            lineHeight: bodyLine,
            fontWeight: labelWeight,
            color: labelColor,
            fontFamily: bodyFont,
          } as TextStyle
        }
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

interface SpaceRowProps {
  space: SwitcherSpace;
  active: boolean;
  onPress: () => void;
  renderAvatar?: (space: SwitcherSpace, size: number) => React.ReactNode;
  renderIcon?: (name: SwitcherIconName, size: number, color: string) => React.ReactNode;
  renderBadge?: (count: number) => React.ReactNode;
  colors: ReturnType<typeof useOctoSpacesTheme>['colors'];
  bodyFont: string | undefined;
  bodySize: number;
  bodyLine: number;
  sp2: number;
  sp3: number;
  sp4: number;
  radMd: number;
}

function SpaceRow({
  space,
  active,
  onPress,
  renderAvatar,
  renderIcon,
  renderBadge,
  colors,
  bodyFont,
  bodySize,
  bodyLine,
  sp2,
  sp3,
  sp4,
  radMd,
}: SpaceRowProps) {
  const unread = space.unread ?? 0;

  return (
    <MenuRow
      accessibilityLabel={active ? `${space.name} (current)` : `Switch to ${space.name}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      leading={renderAvatar ? renderAvatar(space, 24) : null}
      label={space.name}
      labelColor={active ? colors.primary : colors.text}
      labelWeight={active ? '600' : '400'}
      trailing={
        <>
          {unread > 0 && renderBadge ? renderBadge(unread) : null}
          {active && renderIcon ? renderIcon('check', 15, colors.primary) : null}
        </>
      }
      colors={colors}
      bodyFont={bodyFont}
      bodySize={bodySize}
      bodyLine={bodyLine}
      sp2={sp2}
      sp3={sp3}
      sp4={sp4}
      radMd={radMd}
    />
  );
}

interface ActionRowProps {
  label: string;
  iconName: SwitcherIconName;
  onPress: () => void;
  renderIcon?: (name: SwitcherIconName, size: number, color: string) => React.ReactNode;
  colors: ReturnType<typeof useOctoSpacesTheme>['colors'];
  bodyFont: string | undefined;
  bodySize: number;
  bodyLine: number;
  sp2: number;
  sp3: number;
  sp4: number;
  radMd: number;
}

function ActionRow({
  label,
  iconName,
  onPress,
  renderIcon,
  colors,
  bodyFont,
  bodySize,
  bodyLine,
  sp2,
  sp3,
  sp4,
  radMd,
}: ActionRowProps) {
  return (
    <MenuRow
      accessibilityLabel={label}
      onPress={onPress}
      leading={
        renderIcon ? (
          <View style={{ width: 24, alignItems: 'center', justifyContent: 'center' }}>
            {renderIcon(iconName, 15, colors.textSecondary)}
          </View>
        ) : null
      }
      label={label}
      labelColor={colors.text}
      labelWeight="400"
      colors={colors}
      bodyFont={bodyFont}
      bodySize={bodySize}
      bodyLine={bodyLine}
      sp2={sp2}
      sp3={sp3}
      sp4={sp4}
      radMd={radMd}
    />
  );
}
