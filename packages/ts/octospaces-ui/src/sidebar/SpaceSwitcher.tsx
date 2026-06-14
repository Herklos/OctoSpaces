/**
 * Headless themed space-switcher component.
 *
 * Renders a trigger button (active-space avatar + name + chevron) that opens a
 * dropdown listing all spaces with per-row selection, a "join or create" action,
 * optional space settings, and an app-provided footer slot (account section, etc.).
 *
 * The popup container (Popover on desktop, Sheet on mobile) is fully delegated to
 * the host via `renderContainer` so this package stays free of modal dependencies.
 * Avatars and icons are delegated via render-props for the same reason.
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
 *     <>
 *       <Popover visible={isOpen} onClose={onClose} anchorRef={anchorRef} placement="bottom-start" width={240}>
 *         {children}
 *       </Popover>
 *     </>
 *   )}
 *   footerSlot={<AccountSwitcher onRequestClose={...} onViewProfile={...} />}
 * />
 * ```
 */
import React, { useRef, useState } from 'react';
import { Pressable as RNPressable, StyleSheet, Text, View } from 'react-native';
import type { PressableProps, TextStyle, View as RNView } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Structural space item — no SDK dependency. */
export interface SwitcherSpace {
  id: string;
  name: string;
  /** 2-letter monogram used as avatar fallback. */
  short?: string;
  /** Uploaded space image URI; absent → host renders monogram. */
  image?: string;
}

/** Icon name union for the switcher's built-in glyphs. */
export type SwitcherIconName = 'chevron-down' | 'check' | 'plus' | 'gear';

export interface SpaceSwitcherProps {
  spaces: SwitcherSpace[];
  activeId?: string | null;
  /** Called when the user taps a space row. */
  onSelect: (id: string) => void;
  /** "Join or create a space" action. Omit to hide the row. */
  onAdd?: () => void;
  /** Override the add-row label. @default "Join or create a space" */
  addLabel?: string;
  /**
   * "Space settings" action. Only shown when both `onSettings` and `activeId`
   * are provided. Omit to hide.
   */
  onSettings?: () => void;
  /** Override the settings-row label. @default "Space settings" */
  settingsLabel?: string;
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
   * Render a space row's leading avatar.
   * Receives the `SwitcherSpace` and a pixel size.
   * Omit to render nothing in the leading slot.
   */
  renderSpaceAvatar?: (space: SwitcherSpace, size: number) => React.ReactNode;

  /**
   * Render an icon glyph. Name is one of `'chevron-down' | 'check' | 'plus' | 'gear'`.
   * Omit to hide chevron, check, and action icons (spaces remain selectable).
   */
  renderIcon?: (name: SwitcherIconName, size: number, color: string) => React.ReactNode;

  /**
   * Footer rendered below the space list + action rows — use for account-switcher
   * sections (with separator if needed). Fully app-owned.
   */
  footerSlot?: React.ReactNode;
}

// ── Hover-aware Pressable (RN-Web) ────────────────────────────────────────────

type HoverProps = { onMouseEnter?: () => void; onMouseLeave?: () => void };
const Pressable = RNPressable as React.ForwardRefExoticComponent<
  PressableProps & HoverProps & React.RefAttributes<RNView>
>;

// ── Component ─────────────────────────────────────────────────────────────────

export function SpaceSwitcher({
  spaces,
  activeId,
  onSelect,
  onAdd,
  addLabel = 'Join or create a space',
  onSettings,
  settingsLabel = 'Space settings',
  variant,
  renderContainer,
  renderTriggerAvatar,
  renderSpaceAvatar,
  renderIcon,
  footerSlot,
}: SpaceSwitcherProps) {
  const theme = useOctoSpacesTheme();
  const { colors, type: typeScale, fonts, spacing: sp, radii } = theme;

  const [open, setOpen] = useState(false);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const anchorRef = useRef<RNView>(null);

  const active = spaces.find((s) => s.id === activeId) ?? spaces[0] ?? null;

  const close = () => setOpen(false);
  const handleSelect = (id: string) => {
    close();
    onSelect(id);
  };
  const handleAdd = () => {
    close();
    onAdd?.();
  };
  const handleSettings = () => {
    close();
    onSettings?.();
  };

  // ── spacing lookups ──────────────────────────────────────────────────────
  const sp1 = (sp['1'] as number | undefined) ?? 4;
  const sp2 = (sp['2'] as number | undefined) ?? 8;
  const sp3 = (sp['3'] as number | undefined) ?? 12;
  const sp4 = (sp['4'] as number | undefined) ?? 16;
  const radMd = (radii['md'] as number | undefined) ?? 6;

  const bodyFont = fonts['body'] ?? undefined;
  const bodySize = typeScale['callout']?.size ?? 13;
  const bodyLine = typeScale['callout']?.lineHeight ?? 18;
  const labelSize = typeScale['caption']?.size ?? 11;
  const labelLine = typeScale['caption']?.lineHeight ?? 16;

  // ── trigger style ────────────────────────────────────────────────────────
  const triggerStyle =
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
          backgroundColor: triggerHovered
            ? (colors.primarySubtle ?? 'rgba(0,0,0,0.05)')
            : 'transparent',
        }
      : {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          gap: sp2,
          paddingHorizontal: sp2,
          paddingVertical: sp1,
          borderRadius: radMd,
          backgroundColor: triggerHovered
            ? (colors.primarySubtle ?? 'rgba(0,0,0,0.05)')
            : 'transparent',
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

      {spaces.map((s) => (
        <SpaceRow
          key={s.id}
          space={s}
          active={s.id === (active?.id ?? null)}
          onPress={() => handleSelect(s.id)}
          renderAvatar={renderSpaceAvatar}
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
      ))}

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
          {footerSlot}
        </>
      ) : null}
    </View>
  );

  return (
    <>
      <Pressable
        ref={anchorRef}
        accessibilityRole="button"
        accessibilityLabel={active ? `${active.name} — switch space` : 'Switch space'}
        accessibilityState={{ expanded: open }}
        hitSlop={6}
        onPress={() => setOpen(true)}
        onMouseEnter={() => setTriggerHovered(true)}
        onMouseLeave={() => setTriggerHovered(false)}
        style={triggerStyle}
      >
        {renderTriggerAvatar ? renderTriggerAvatar(active, 22) : null}
        <Text
          numberOfLines={1}
          style={
            {
              flex: variant === 'sidebar' ? 1 : undefined,
              minWidth: 0,
              flexShrink: 1,
              fontSize: typeScale['heading']?.size ?? 15,
              lineHeight: typeScale['heading']?.lineHeight ?? 20,
              fontWeight: '600',
              color: colors.text,
              fontFamily: bodyFont,
            } as TextStyle
          }
        >
          {active?.name ?? 'Spaces'}
        </Text>
        {renderIcon ? renderIcon('chevron-down', 14, colors.textTertiary) : null}
      </Pressable>

      {renderContainer({ isOpen: open, onClose: close, anchorRef, children: dropdownContent })}
    </>
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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

interface SpaceRowProps {
  space: SwitcherSpace;
  active: boolean;
  onPress: () => void;
  renderAvatar?: (space: SwitcherSpace, size: number) => React.ReactNode;
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

function SpaceRow({
  space,
  active,
  onPress,
  renderAvatar,
  renderIcon,
  colors,
  bodyFont,
  bodySize,
  bodyLine,
  sp2,
  sp3,
  sp4,
  radMd,
}: SpaceRowProps) {
  const [hovered, setHovered] = useState(false);

  const bg = hovered
    ? (colors.primarySubtle ?? 'rgba(0,0,0,0.04)')
    : 'transparent';

  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={active ? `${space.name} (current)` : `Switch to ${space.name}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp3,
        paddingHorizontal: sp4,
        paddingVertical: sp2,
        borderRadius: radMd,
        backgroundColor: bg,
      }}
    >
      {renderAvatar ? renderAvatar(space, 24) : null}
      <Text
        numberOfLines={1}
        style={
          {
            flex: 1,
            minWidth: 0,
            fontSize: bodySize,
            lineHeight: bodyLine,
            fontWeight: active ? '600' : '400',
            color: active ? colors.primary : colors.text,
            fontFamily: bodyFont,
          } as TextStyle
        }
      >
        {space.name}
      </Text>
      {active && renderIcon ? renderIcon('check', 15, colors.primary) : null}
    </Pressable>
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
  const [hovered, setHovered] = useState(false);

  const bg = hovered
    ? (colors.primarySubtle ?? 'rgba(0,0,0,0.04)')
    : 'transparent';

  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      onPress={onPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp3,
        paddingHorizontal: sp4,
        paddingVertical: sp2,
        borderRadius: radMd,
        backgroundColor: bg,
      }}
    >
      {renderIcon ? (
        <View style={{ width: 24, alignItems: 'center', justifyContent: 'center' }}>
          {renderIcon(iconName, 15, colors.textSecondary)}
        </View>
      ) : null}
      <Text
        numberOfLines={1}
        style={
          {
            flex: 1,
            minWidth: 0,
            fontSize: bodySize,
            lineHeight: bodyLine,
            fontWeight: '400',
            color: colors.text,
            fontFamily: bodyFont,
          } as TextStyle
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
