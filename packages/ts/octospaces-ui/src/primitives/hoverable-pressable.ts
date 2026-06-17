/**
 * `Pressable` re-typed to also accept web pointer-hover handlers.
 *
 * React Native's `Pressable` accepts `onMouseEnter` / `onMouseLeave` on web (via
 * react-native-web) but does not type them. Every sidebar component re-cast the
 * import locally; this single shared cast replaces those copies.
 */
import { Pressable as RNPressable } from 'react-native';
import type { PressableProps, View as RNView } from 'react-native';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';

/** Web pointer-hover handlers RN's `Pressable` accepts on web but doesn't type. */
export type HoverProps = { onMouseEnter?: () => void; onMouseLeave?: () => void };

/** `Pressable` typed with web hover handlers + a forwarded `View` ref. */
export const HoverablePressable = RNPressable as ForwardRefExoticComponent<
  PressableProps & HoverProps & RefAttributes<RNView>
>;
