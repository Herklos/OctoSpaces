/**
 * Component-render tests for <SpaceSwitcher> dropdown rows (SpaceRow / ActionRow).
 * A pass-through `renderContainer` renders the dropdown content immediately so the
 * rows can be queried without driving the open/close state. Guards the MenuRow
 * extraction against behavior drift.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { SpaceSwitcher } from './SpaceSwitcher.js';
import type { SwitcherSpace } from './SpaceSwitcher.js';
import { renderThemed } from '../test/theme-fixture.js';

const spaces: SwitcherSpace[] = [
  { id: 's1', name: 'Alpha', short: 'AL' },
  { id: 's2', name: 'Beta', short: 'BE' },
];

function renderSwitcher(extra: Record<string, unknown> = {}) {
  return renderThemed(
    <SpaceSwitcher
      spaces={spaces}
      activeId="s1"
      variant="sidebar"
      onSelect={() => {}}
      renderContainer={({ children }) => <>{children}</>}
      {...extra}
    />,
  );
}

describe('<SpaceSwitcher> dropdown rows', () => {
  it('renders a menuitem per space with active-aware accessibility labels', () => {
    renderSwitcher();
    expect(screen.getByLabelText('Alpha (current)')).toBeTruthy();
    expect(screen.getByLabelText('Switch to Beta')).toBeTruthy();
  });

  it('renders the add action row only when onAdd is provided', () => {
    renderSwitcher({ onAdd: () => {}, addLabel: 'Join or create a space' });
    expect(screen.getByLabelText('Join or create a space')).toBeTruthy();
  });

  it('renders the settings action row when onSettings + activeId are set', () => {
    renderSwitcher({ onSettings: () => {}, settingsLabel: 'Space settings' });
    expect(screen.getByLabelText('Space settings')).toBeTruthy();
  });

  it('omits the add row when onAdd is absent', () => {
    renderSwitcher();
    expect(screen.queryByLabelText('Join or create a space')).toBeNull();
  });
});
