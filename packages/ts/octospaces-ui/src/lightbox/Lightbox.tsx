/**
 * Full-screen scrim overlay that centers its content. Tapping the backdrop, the
 * close button, the Escape key (web) or the hardware back (Android) dismisses it.
 *
 * All interactive chrome (close button, action buttons) is injected via render
 * props so this package remains free of @expo/vector-icons, expo-image, and
 * reanimated. The host app renders its own icon buttons and images.
 *
 * @example
 * ```tsx
 * import { Lightbox } from '@drakkar.software/octospaces-ui';
 *
 * <Lightbox
 *   visible={zoomed}
 *   onClose={() => setZoomed(false)}
 *   renderCloseButton={(onClose) => (
 *     <IconButton name="x" color={colors.onScrim} onPress={onClose} />
 *   )}
 *   renderActions={() => (
 *     <IconButton name="share" color={colors.onScrim} onPress={handleShare} />
 *   )}
 * >
 *   <Image source={{ uri }} style={{ width: w * 0.92, height: h * 0.82 }} />
 * </Lightbox>
 * ```
 */
import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';

export interface LightboxProps {
  visible: boolean;
  onClose: () => void;
  /** Centered content — the host renders the full-size image here. */
  children: ReactNode;
  /** Accessible label for the backdrop tap-to-close. Default: "Close preview". */
  closeLabel?: string;
  /**
   * Render the close affordance pinned to the top-right corner.
   * Receives `onClose` so the button can dismiss the overlay.
   * If omitted, tapping the backdrop or hardware back still closes it.
   */
  renderCloseButton?: (onClose: () => void) => ReactNode;
  /**
   * Render additional action(s) pinned to the bottom-right corner,
   * e.g. a save/share button. Return `null` to show nothing.
   */
  renderActions?: () => ReactNode;
}

/**
 * Full-screen scrim overlay that centers its children. Headless: all buttons
 * are injected via render props; the package has no icon or image dependencies.
 *
 * Dismissal: backdrop tap · `renderCloseButton` · hardware back (Android) ·
 * Escape key (web).
 */
export function Lightbox({
  visible,
  onClose,
  children,
  closeLabel = 'Close preview',
  renderCloseButton,
  renderActions,
}: LightboxProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();

  // Web has no hardware back button; close on Escape to match the native affordance.
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  // Spacing token lookups use numeric keys (OctoChat) with named-key fallbacks
  // (OctoVault) so the overlay is correctly inset in either host.
  const pad = t.sp('6');
  const insetV = t.sp('8');
  const insetH = t.sp('4');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop — full-screen scrim, tap anywhere to close */}
      <Pressable
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: pad,
          backgroundColor: theme.colors.overlay ?? 'rgba(0,0,0,0.85)',
        }}
        onPress={onClose}
        accessibilityLabel={closeLabel}
      >
        {/* Content — pointerEvents="box-none" so the View itself doesn't intercept
            taps (they fall through to the backdrop), but its children still can. */}
        <View
          style={{ alignItems: 'center', justifyContent: 'center' }}
          pointerEvents="box-none"
        >
          {children}
        </View>

        {/* Close slot — top-right corner */}
        {renderCloseButton ? (
          <View style={{ position: 'absolute', top: insetV, right: insetH }}>
            {renderCloseButton(onClose)}
          </View>
        ) : null}

        {/* Action slot — bottom-right corner */}
        {renderActions ? (
          <View style={{ position: 'absolute', bottom: insetV, right: insetH }}>
            {renderActions()}
          </View>
        ) : null}
      </Pressable>
    </Modal>
  );
}
