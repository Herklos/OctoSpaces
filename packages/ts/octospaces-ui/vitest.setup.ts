import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount any rendered trees between tests (we don't use vitest `globals`, so
// auto-cleanup isn't wired — do it explicitly).
afterEach(() => cleanup());
