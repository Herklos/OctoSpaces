import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerPull,
  dispatchDocChange,
  emitSseStatus,
  onSseStatus,
  clearLiveSyncBus,
} from '../../src/utils/live-sync-bus.js';

beforeEach(() => clearLiveSyncBus());

// ── registerPull / dispatchDocChange ──────────────────────────────────────────

describe('registerPull / dispatchDocChange', () => {
  it('returns false when no pull is registered for the path', () => {
    expect(dispatchDocChange('spaces/sp-1/objects/_index')).toBe(false);
  });

  it('calls the registered pull and returns true', () => {
    const pull = vi.fn();
    registerPull('spaces/sp-1/objects/_index', pull);
    const dispatched = dispatchDocChange('spaces/sp-1/objects/_index');
    expect(dispatched).toBe(true);
    expect(pull).toHaveBeenCalledOnce();
  });

  it('does not cross-fire — different paths are independent', () => {
    const pull1 = vi.fn();
    const pull2 = vi.fn();
    registerPull('spaces/sp-1/objects/_index', pull1);
    registerPull('spaces/sp-2/objects/_index', pull2);
    dispatchDocChange('spaces/sp-1/objects/_index');
    expect(pull1).toHaveBeenCalledOnce();
    expect(pull2).not.toHaveBeenCalled();
  });

  it('unsubscribe removes the registration', () => {
    const pull = vi.fn();
    const unsub = registerPull('spaces/sp-1/objects/_index', pull);
    unsub();
    expect(dispatchDocChange('spaces/sp-1/objects/_index')).toBe(false);
    expect(pull).not.toHaveBeenCalled();
  });

  it('stale unsubscribe is a no-op after re-registration', () => {
    const pull1 = vi.fn();
    const pull2 = vi.fn();
    const unsub1 = registerPull('spaces/sp-1/objects/_index', pull1);
    registerPull('spaces/sp-1/objects/_index', pull2); // overwrites
    unsub1(); // should NOT remove pull2
    dispatchDocChange('spaces/sp-1/objects/_index');
    expect(pull2).toHaveBeenCalledOnce();
  });
});

// ── emitSseStatus / onSseStatus ───────────────────────────────────────────────

describe('emitSseStatus / onSseStatus', () => {
  it('fires immediately with the current state (false by default)', () => {
    const cb = vi.fn();
    onSseStatus(cb);
    expect(cb).toHaveBeenCalledWith(false);
  });

  it('fires on each status change', () => {
    const cb = vi.fn();
    onSseStatus(cb);
    emitSseStatus(true);
    emitSseStatus(false);
    expect(cb).toHaveBeenNthCalledWith(1, false); // initial
    expect(cb).toHaveBeenNthCalledWith(2, true);
    expect(cb).toHaveBeenNthCalledWith(3, false);
  });

  it('unsubscribe stops receiving updates', () => {
    const cb = vi.fn();
    const unsub = onSseStatus(cb);
    unsub();
    emitSseStatus(true);
    expect(cb).toHaveBeenCalledOnce(); // only the initial fire
  });

  it('new subscriber gets current state after emitSseStatus(true)', () => {
    emitSseStatus(true);
    const cb = vi.fn();
    onSseStatus(cb);
    expect(cb).toHaveBeenCalledWith(true);
  });
});

// ── clearLiveSyncBus ──────────────────────────────────────────────────────────

describe('clearLiveSyncBus', () => {
  it('clears all registered pulls', () => {
    const pull = vi.fn();
    registerPull('spaces/sp-1/objects/_index', pull);
    clearLiveSyncBus();
    expect(dispatchDocChange('spaces/sp-1/objects/_index')).toBe(false);
  });

  it('resets SSE health to false', () => {
    emitSseStatus(true);
    clearLiveSyncBus();
    const cb = vi.fn();
    onSseStatus(cb);
    expect(cb).toHaveBeenCalledWith(false);
  });

  it('leaves status listeners intact (they self-unsub on unmount)', () => {
    const cb = vi.fn();
    onSseStatus(cb);
    clearLiveSyncBus();
    emitSseStatus(true);
    expect(cb).toHaveBeenCalledWith(true); // still fires
  });
});
