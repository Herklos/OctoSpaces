import { describe, it, expect } from 'vitest';
import {
  interactionBg,
  INTERACTION_BG_PRESSED_FALLBACK,
  INTERACTION_BG_HOVERED_FALLBACK,
} from './interaction-bg.js';

describe('interactionBg', () => {
  it('returns the pressed color when pressed (wins over hovered)', () => {
    expect(interactionBg({ pressed: true, hovered: true }, { pressed: '#p', hovered: '#h' })).toBe('#p');
  });

  it('returns the hovered color when only hovered', () => {
    expect(interactionBg({ hovered: true }, { pressed: '#p', hovered: '#h' })).toBe('#h');
  });

  it('returns the base when neither pressed nor hovered', () => {
    expect(interactionBg({}, { pressed: '#p', hovered: '#h', base: '#b' })).toBe('#b');
  });

  it("defaults base to 'transparent'", () => {
    expect(interactionBg({}, { pressed: '#p', hovered: '#h' })).toBe('transparent');
  });

  it('falls back to the canonical pressed rgba when no pressed color is supplied', () => {
    expect(interactionBg({ pressed: true }, {})).toBe(INTERACTION_BG_PRESSED_FALLBACK);
  });

  it('falls back to the canonical hovered rgba when no hovered color is supplied', () => {
    expect(interactionBg({ hovered: true }, {})).toBe(INTERACTION_BG_HOVERED_FALLBACK);
  });

  it('host color beats the canonical fallback', () => {
    expect(interactionBg({ pressed: true }, { pressed: '#themed' })).toBe('#themed');
  });
});
