/**
 * Component-render tests for <Badge> — exercises the count/dot/clamp/tone branches
 * through the react-native-web render harness (jsdom).
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Badge } from './Badge.js';
import { renderThemed } from '../test/theme-fixture.js';

describe('<Badge>', () => {
  it('renders the count', () => {
    renderThemed(<Badge count={3} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders nothing when count <= 0 and not a dot', () => {
    const { container } = renderThemed(<Badge count={0} />);
    expect(container.textContent).toBe('');
  });

  it('clamps counts over 99 to "99+" by default', () => {
    renderThemed(<Badge count={150} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('does NOT clamp when clamp={false}', () => {
    renderThemed(<Badge count={150} clamp={false} />);
    expect(screen.getByText('150')).toBeTruthy();
    expect(screen.queryByText('99+')).toBeNull();
  });

  it('dot mode renders no text even when count is 0', () => {
    const { container } = renderThemed(<Badge count={0} dot />);
    // No label text, but an element IS rendered (the dot view).
    expect(container.textContent).toBe('');
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders the count for each tone without throwing', () => {
    for (const tone of ['accent', 'danger', 'neutral'] as const) {
      const { unmount } = renderThemed(<Badge count={7} tone={tone} />);
      expect(screen.getByText('7')).toBeTruthy();
      unmount();
    }
  });
});
