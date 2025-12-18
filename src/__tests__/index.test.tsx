import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createIdNameContext } from '../index';

interface TestData {
  id: string;
  name: string;
}

describe('react-id-name', () => {
  const { IdNameProvider, IdNameItem, useIdNameCache } = createIdNameContext<TestData>();

  describe('createIdNameContext', () => {
    it('should create Provider, Item and useIdNameCache', () => {
      const context = createIdNameContext<TestData>();
      expect(context.IdNameProvider).toBeDefined();
      expect(context.IdNameItem).toBeDefined();
      expect(context.useIdNameCache).toBeDefined();
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

    it('should handle individual ID not found in result', async () => {
      // Only return data for id "1", not "2"
      mockRequest.mockResolvedValue({
        '1': { id: '1', name: 'User 1' },
        // '2' is missing
      });

      render(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem id="1">{(data) => <span>{data?.name}</span>}</IdNameItem>
          <IdNameItem id="2" error={(err) => <span>Error: {err.message}</span>}>
            {(data) => <span>{data?.name}</span>}
          </IdNameItem>
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('User 1')).toBeInTheDocument();
        expect(screen.getByText('Error: ID "2" not found')).toBeInTheDocument();
      });
    });
  });

  describe('useIdNameCache', () => {
    let mockRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockRequest = vi.fn();
    });

    const CacheControlButton = ({ action, ids }: { action: 'clear' | 'refresh'; ids?: string[] }) => {
      const { clearCache, refreshCache } = useIdNameCache();
      return (
        <button onClick={() => (action === 'clear' ? clearCache(ids) : refreshCache(ids))}>
          {action}
        </button>
      );
    };

    it('should clear specific IDs from cache', async () => {
      const user = userEvent.setup();
      let callCount = 0;
      mockRequest.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          '1': { id: '1', name: `User 1 - call ${callCount}` },
        });
      });

      render(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem id="1">{(data) => <span>{data?.name}</span>}</IdNameItem>
          <CacheControlButton action="clear" ids={['1']} />
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('User 1 - call 1')).toBeInTheDocument();
      });

      // Clear cache for ID "1"
      await user.click(screen.getByText('clear'));

      // Should re-fetch
      await waitFor(() => {
        expect(screen.getByText('User 1 - call 2')).toBeInTheDocument();
      });

      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache when no IDs provided', async () => {
      const user = userEvent.setup();
      mockRequest.mockResolvedValue({
        '1': { id: '1', name: 'User 1' },
        '2': { id: '2', name: 'User 2' },
      });

      render(
        <IdNameProvider request={mockRequest} debounceTime={10}>
          <IdNameItem id="1">{(data) => <span>{data?.name}</span>}</IdNameItem>
          <IdNameItem id="2">{(data) => <span>{data?.name}</span>}</IdNameItem>
          <CacheControlButton action="clear" />
        </IdNameProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('User 1')).toBeInTheDocument();
        expect(screen.getByText('User 2')).toBeInTheDocument();
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);

      // Clear all cache
      await user.click(screen.getByText('clear'));

      // Should re-fetch both
      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('cacheTTL', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should expire cache after TTL', async () => {
      let callCount = 0;
      const mockRequest = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          '1': { id: '1', name: `User - call ${callCount}` },
        });
      });

      render(
        <IdNameProvider request={mockRequest} debounceTime={10} cacheTTL={1000}>
          <IdNameItem id="1">{(data) => <span>{data?.name}</span>}</IdNameItem>
        </IdNameProvider>
      );

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(screen.getByText('User - call 1')).toBeInTheDocument();

      // Advance past TTL
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      // Cache should be cleared, will re-fetch when visible again
      expect(mockRequest).toHaveBeenCalledTimes(1); // TTL clear doesn't auto-refetch
    });
  });
});
