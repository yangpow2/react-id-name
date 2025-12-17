import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock react-intersection-observer
vi.mock('react-intersection-observer', () => ({
  useInView: () => ({
    ref: vi.fn(),
    inView: true, // Always visible in tests
  }),
}));
