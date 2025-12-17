import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createIdNameContext } from '../index';

interface TestData {
  id: string;
  name: string;
}

describe('react-id-name', () => {
  const { IdNameProvider, IdNameItem } = createIdNameContext<TestData>();

  describe('createIdNameContext', () => {
    it('should create Provider and Item components', () => {
      const context = createIdNameContext<TestData>();
      expect(context.IdNameProvider).toBeDefined();
      expect(context.IdNameItem).toBeDefined();
      expect(context.IdNameContext).toBeDefined();
    });
  });

  describe('IdNameProvider & IdNameItem', () => {
    let mockRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockRequest = vi.fn();
    });

    it('should render loading state initially', () => {
      mockRequest.mockImplementation(() => new Promise(() => {})); // never resolves

      render(
        <IdNameProvider request={mockRequest}>
          <IdNameItem id="1" loading={<span>Loading...</span>}>
            {(data) => <span>{data?.name}</span>}
          </IdNameItem>
        </IdNameProvider>
      );

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('should render data after fetch', async () => {
      mockRequest.mockResolvedValue({
        '1': { id: '1', name: 'Test User' },
      });

      render(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem id="1">
            {(data) => <span>{data?.name ?? 'No data'}</span>}
          </IdNameItem>
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Test User')).toBeInTheDocument();
      });
    });

    it('should batch multiple requests', async () => {
      mockRequest.mockResolvedValue({
        '1': { id: '1', name: 'User 1' },
        '2': { id: '2', name: 'User 2' },
        '3': { id: '3', name: 'User 3' },
      });

      render(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem id="1">{(data) => <span>{data?.name}</span>}</IdNameItem>
          <IdNameItem id="2">{(data) => <span>{data?.name}</span>}</IdNameItem>
          <IdNameItem id="3">{(data) => <span>{data?.name}</span>}</IdNameItem>
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('User 1')).toBeInTheDocument();
        expect(screen.getByText('User 2')).toBeInTheDocument();
        expect(screen.getByText('User 3')).toBeInTheDocument();
      });

      // Should only call request once with all IDs
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith(['1', '2', '3']);
    });

    it('should use cache for duplicate IDs', async () => {
      mockRequest.mockResolvedValue({
        '1': { id: '1', name: 'Cached User' },
      });

      const { rerender } = render(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem id="1">{(data) => <span>{data?.name}</span>}</IdNameItem>
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Cached User')).toBeInTheDocument();
      });

      // Rerender with same ID
      rerender(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem id="1">{(data) => <span>{data?.name}</span>}</IdNameItem>
          <IdNameItem id="1">{(data) => <span>{data?.name}-copy</span>}</IdNameItem>
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Cached User-copy')).toBeInTheDocument();
      });

      // Should still only have been called once
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('should handle errors', async () => {
      mockRequest.mockRejectedValue(new Error('Network error'));

      render(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem
            id="1"
            error={(err) => <span>Error: {err.message}</span>}
          >
            {(data) => <span>{data?.name}</span>}
          </IdNameItem>
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Error: Network error')).toBeInTheDocument();
      });
    });

    it('should show children on error when showChildrenOnError is true', async () => {
      mockRequest.mockRejectedValue(new Error('Failed'));

      render(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem id="1" showChildrenOnError>
            {(data) => <span>{data?.name ?? 'Fallback'}</span>}
          </IdNameItem>
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Fallback')).toBeInTheDocument();
      });
    });
  });
});
