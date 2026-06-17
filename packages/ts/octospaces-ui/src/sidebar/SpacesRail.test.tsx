/**
 * Component-render tests for <SpacesRail> (PlainTile path — no `useTileDnd`).
 * Focuses on the accessibility label sourcing introduced with `RailSpace.name`.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { SpacesRail } from './SpacesRail.js';
import type { RailSpace } from './types.js';
import { renderThemed } from '../test/theme-fixture.js';

describe('<SpacesRail> accessibility label', () => {
  it('uses the full `name` for a tile when present', () => {
    const spaces: RailSpace[] = [{ id: 's1', short: 'AB', name: 'Alpha Beta' }];
    renderThemed(<SpacesRail spaces={spaces} />);
    expect(screen.getByLabelText('Alpha Beta')).toBeTruthy();
  });

  it('falls back to `short` when `name` is absent', () => {
    const spaces: RailSpace[] = [{ id: 's1', short: 'CD' }];
    renderThemed(<SpacesRail spaces={spaces} />);
    expect(screen.getByLabelText('CD')).toBeTruthy();
  });

  it('renders the monogram text in the PlainTile', () => {
    const spaces: RailSpace[] = [{ id: 's1', short: 'EF', name: 'Echo Foxtrot' }];
    renderThemed(<SpacesRail spaces={spaces} />);
    expect(screen.getByText('EF')).toBeTruthy();
  });

  it('renders one labelled tile per space', () => {
    const spaces: RailSpace[] = [
      { id: 's1', short: 'AA', name: 'Space One' },
      { id: 's2', short: 'BB', name: 'Space Two' },
    ];
    renderThemed(<SpacesRail spaces={spaces} />);
    expect(screen.getByLabelText('Space One')).toBeTruthy();
    expect(screen.getByLabelText('Space Two')).toBeTruthy();
  });
});
