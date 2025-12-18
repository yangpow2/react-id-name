import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  createContext,
  ReactNode,
} from 'react';
import { useInView } from 'react-intersection-observer';

// ============ Types ============

type AsyncState<T> =
  | { loading: true; error?: undefined; value?: undefined; isInit?: boolean }
  | { loading: false; error: Error; value?: undefined; isInit?: boolean }
  | { loading: false; error?: undefined; value: T; isInit?: boolean };

type AsyncFnReturn<T> = [AsyncState<T>, () => Promise<void>];

type CacheMap<T> = Record<string, AsyncFnReturn<T>>;

interface ContextValue<T> {
  cacheMapState: CacheMap<T>;
  onItemView: (id: string) => void;
  clearCache: (ids?: string[]) => void;
  refreshCache: (ids?: string[]) => void;
  __isProviderMounted: boolean;
}

export interface IdNameProviderProps<T> {
  children: ReactNode;
  /** Batch fetch function: receives an array of IDs, returns a map of id -> data */
  request: (ids: string[]) => Promise<Record<string, T>>;
  /** Debounce time in ms (default: 80) */
  debounceTime?: number;
  /** Cache TTL in ms. If set, cached data will be refreshed after this time (default: no expiration) */
  cacheTTL?: number;
}

export interface IdNameItemProps<T> {
  /** The ID to resolve */
  id: string;
  /** Render function that receives the resolved data */
  children: (data: T | null, error?: Error) => ReactNode;
  /** Custom loading component */
  loading?: ReactNode;
  /** Custom error component, receives error and retry function */
  error?: (error: Error, retry: () => void) => ReactNode;
  /** If true, calls children with null when error occurs instead of showing error component */
  showChildrenOnError?: boolean;
  /** Additional className for the wrapper span */
  className?: string;
}

// ============ Reducer ============

const CACHE_ACTION = {
  ADD: 'ADD' as const,
  UPDATE: 'UPDATE' as const,
  CLEAR: 'CLEAR' as const,
  CLEAR_ALL: 'CLEAR_ALL' as const,
};

type CacheAction<T> =
  | { type: typeof CACHE_ACTION.ADD; payload: CacheMap<T> }
  | { type: typeof CACHE_ACTION.UPDATE; payload: CacheMap<T> }
  | { type: typeof CACHE_ACTION.CLEAR; payload: string[] }
  | { type: typeof CACHE_ACTION.CLEAR_ALL };

function cacheReducer<T>(state: CacheMap<T>, action: CacheAction<T>): CacheMap<T> {
  switch (action.type) {
    case CACHE_ACTION.ADD:
      return { ...action.payload, ...state }; // Don't overwrite existing
    case CACHE_ACTION.UPDATE:
      return { ...state, ...action.payload }; // Force update
    case CACHE_ACTION.CLEAR: {
      const newState = { ...state };
      action.payload.forEach((id) => delete newState[id]);
      return newState;
    }
    case CACHE_ACTION.CLEAR_ALL:
      return {};
    default:
      return state;
  }
}

// ============ Hook: useDebounce ============

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ============ Default Components ============

const DefaultLoading = () => <span>...</span>;

const DefaultError = ({ error, onRetry }: { error: Error; onRetry: () => void }) => (
  <span title={error.message} style={{ color: 'red', cursor: 'pointer' }} onClick={onRetry}>
    ⚠
  </span>
);

// ============ Factory Function ============

const DEFAULT_DEBOUNCE_TIME = 80;

/** Create a fresh init state to avoid shared reference issues */
const createInitState = <T,>(): AsyncFnReturn<T> => [
  { loading: true, error: undefined, value: undefined, isInit: true },
  async () => {},
];

/**
 * Create a pair of Provider and Item components for resolving IDs to names/details.
 *
 * @example
 * ```tsx
 * const { IdNameProvider, IdNameItem } = createIdNameContext<UserInfo>();
 *
 * // In your app
 * <IdNameProvider request={async (ids) => fetchUsers(ids)}>
 *   <UserList />
 * </IdNameProvider>
 *
 * // In UserList
 * <IdNameItem id={userId}>
 *   {(user) => <span>{user?.name}</span>}
 * </IdNameItem>
 * ```
 */
export function createIdNameContext<T>() {
  const IdNameContext = createContext<ContextValue<T>>({
    cacheMapState: {},
    onItemView: () => {},
    clearCache: () => {},
    refreshCache: () => {},
    __isProviderMounted: false,
  });
  IdNameContext.displayName = 'IdNameContext';

  /**
   * Provider component that manages the cache and batch fetching logic.
   */
  const IdNameProvider = ({
    children,
    request,
    debounceTime = DEFAULT_DEBOUNCE_TIME,
    cacheTTL,
  }: IdNameProviderProps<T>) => {
    const [cacheMapState, cacheMapDispatch] = useReducer(cacheReducer<T>, {});
    const mountedRef = useRef(true);
    const cacheTimestamps = useRef<Record<string, number>>({});

    // Cleanup on unmount
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    const needUpdateIds = useMemo(
      () => Object.keys(cacheMapState).filter((k) => cacheMapState[k]?.[0]?.isInit),
      [cacheMapState]
    );

    const debouncedNeedUpdateIds = useDebounce(needUpdateIds, debounceTime);

    const batchUpdate = useCallback(
      async (ids: string[], isMounted: () => boolean = () => mountedRef.current) => {
        if (ids.length === 0) return;

        // Set loading state (create fresh objects for each id)
        const loadingStateMap: CacheMap<T> = Object.fromEntries(
          ids.map((id) => [id, createInitState<T>()])
        );
        cacheMapDispatch({ type: CACHE_ACTION.UPDATE, payload: loadingStateMap });

        try {
          const resultMap = await request(ids);

          // Check if still mounted before updating state
          if (!isMounted()) return;

          const now = Date.now();
          const successStateMap: CacheMap<T> = {};
          const errorStateMap: CacheMap<T> = {};

          // Handle each ID individually - some may succeed, some may fail
          ids.forEach((id) => {
            const result = resultMap[id];
            if (result !== undefined) {
              cacheTimestamps.current[id] = now;
              successStateMap[id] = [
                { value: result, loading: false, error: undefined },
                async () => {
                  if (mountedRef.current) {
                    batchUpdate([id]);
                  }
                },
              ];
            } else {
              // ID not found in result - treat as individual error
              errorStateMap[id] = [
                { value: undefined, loading: false, error: new Error(`ID "${id}" not found`) },
                async () => {
                  if (mountedRef.current) {
                    batchUpdate([id]);
                  }
                },
              ];
            }
          });

          if (Object.keys(successStateMap).length > 0) {
            cacheMapDispatch({ type: CACHE_ACTION.UPDATE, payload: successStateMap });
          }
          if (Object.keys(errorStateMap).length > 0) {
            cacheMapDispatch({ type: CACHE_ACTION.UPDATE, payload: errorStateMap });
          }
        } catch (e) {
          // Check if still mounted before updating state
          if (!isMounted()) return;

          const error = e instanceof Error ? e : new Error(String(e));
          const errorStateMap: CacheMap<T> = Object.fromEntries(
            ids.map((id) => [
              id,
              [
                { value: undefined, loading: false, error },
                async () => {
                  if (mountedRef.current) {
                    batchUpdate([id]);
                  }
                },
              ],
            ])
          );
          cacheMapDispatch({ type: CACHE_ACTION.UPDATE, payload: errorStateMap });
        }
      },
      [request]
    );

    useEffect(() => {
      if (debouncedNeedUpdateIds.length > 0) {
        batchUpdate(debouncedNeedUpdateIds);
      }
    }, [batchUpdate, debouncedNeedUpdateIds]);

    // TTL check effect
    useEffect(() => {
      if (!cacheTTL) return;

      const checkExpired = () => {
        const now = Date.now();
        const expiredIds = Object.keys(cacheTimestamps.current).filter(
          (id) => now - cacheTimestamps.current[id] > cacheTTL
        );
        if (expiredIds.length > 0) {
          // Clear expired entries, they will be re-fetched when visible
          cacheMapDispatch({ type: CACHE_ACTION.CLEAR, payload: expiredIds });
          expiredIds.forEach((id) => delete cacheTimestamps.current[id]);
        }
      };

      const interval = setInterval(checkExpired, Math.min(cacheTTL, 60000));
      return () => clearInterval(interval);
    }, [cacheTTL]);

    const onItemView = useCallback((id: string) => {
      cacheMapDispatch({ type: CACHE_ACTION.ADD, payload: { [id]: createInitState<T>() } });
    }, []);

    const clearCache = useCallback((ids?: string[]) => {
      if (ids && ids.length > 0) {
        cacheMapDispatch({ type: CACHE_ACTION.CLEAR, payload: ids });
        ids.forEach((id) => delete cacheTimestamps.current[id]);
      } else {
        cacheMapDispatch({ type: CACHE_ACTION.CLEAR_ALL });
        cacheTimestamps.current = {};
      }
    }, []);

    const refreshCache = useCallback(
      (ids?: string[]) => {
        const idsToRefresh = ids || Object.keys(cacheMapState);
        if (idsToRefresh.length > 0) {
          // Clear and re-fetch
          clearCache(idsToRefresh);
        }
      },
      [cacheMapState, clearCache]
    );

    return (
      <IdNameContext.Provider
        value={{
          cacheMapState,
          onItemView,
          clearCache,
          refreshCache,
          __isProviderMounted: true,
        }}
      >
        {children}
      </IdNameContext.Provider>
    );
  };
  IdNameProvider.displayName = 'IdNameProvider';

  /**
   * Internal component that handles the actual rendering logic.
   * Separated to ensure hooks are called unconditionally.
   */
  const IdNameItemInner = ({
    id,
    children,
    loading: loadingComponent,
    error: errorComponent,
    showChildrenOnError = false,
    className,
    cacheMapState,
    onItemView,
  }: IdNameItemProps<T> & Pick<ContextValue<T>, 'cacheMapState' | 'onItemView'>) => {
    const { ref, inView } = useInView();
    const state = cacheMapState[id];

    // Trigger fetch when visible and not yet in cache
    useEffect(() => {
      if (inView && !state) {
        onItemView(id);
      }
    }, [inView, state, onItemView, id]);

    // Not yet registered
    if (!state) {
      return <span ref={ref} className={className} />;
    }

    const [asyncState, retry] = state;

    return (
      <span ref={ref} className={className}>
        {asyncState.loading ? (
          loadingComponent ?? <DefaultLoading />
        ) : asyncState.error ? (
          showChildrenOnError ? (
            children(null, asyncState.error)
          ) : (
            errorComponent?.(asyncState.error, retry) ?? <DefaultError error={asyncState.error} onRetry={retry} />
          )
        ) : (
          children(asyncState.value as T)
        )}
      </span>
    );
  };

  /**
   * Item component that resolves a single ID and renders the result.
   * Only fetches when the element is visible in the viewport.
   */
  const IdNameItem = (props: IdNameItemProps<T>) => {
    const context = useContext(IdNameContext);

    // Check if provider is mounted
    if (!context.__isProviderMounted) {
      const message = 'IdNameItem must be used within an IdNameProvider';
      if (typeof window !== 'undefined' && (window as any).__DEV__) {
        throw new Error(message);
      }
      console.warn(message);
      return null;
    }

    // Validate id
    if (props.id == null || props.id === '') {
      console.warn('[IdNameItem] id cannot be null or empty');
      return null;
    }

    return (
      <IdNameItemInner
        {...props}
        cacheMapState={context.cacheMapState}
        onItemView={context.onItemView}
      />
    );
  };
  IdNameItem.displayName = 'IdNameItem';

  /**
   * Hook to access cache control functions.
   * @returns { clearCache, refreshCache } functions
   */
  const useIdNameCache = () => {
    const context = useContext(IdNameContext);
    if (!context.__isProviderMounted) {
      throw new Error('useIdNameCache must be used within an IdNameProvider');
    }
    return {
      /** Clear specific IDs from cache, or all if no IDs provided */
      clearCache: context.clearCache,
      /** Refresh specific IDs, or all cached IDs if no IDs provided */
      refreshCache: context.refreshCache,
    };
  };

  return {
    IdNameProvider,
    IdNameItem,
    /** Hook to access cache control functions */
    useIdNameCache,
    /** The underlying context, for advanced use cases */
    IdNameContext,
  };
}

export default createIdNameContext;

// ============ Default Instance ============

/**
 * Pre-built instance for simple { id, name } data.
 * For quick usage without creating your own context.
 *
 * @example
 * ```tsx
 * import { SimpleIdNameProvider, SimpleIdNameItem, useSimpleIdNameCache } from 'react-id-name';
 *
 * <SimpleIdNameProvider request={fetchNames}>
 *   <SimpleIdNameItem id="123">{(data) => data?.name}</SimpleIdNameItem>
 * </SimpleIdNameProvider>
 * ```
 */
export const {
  IdNameProvider: SimpleIdNameProvider,
  IdNameItem: SimpleIdNameItem,
  useIdNameCache: useSimpleIdNameCache,
  IdNameContext: SimpleIdNameContext,
} = createIdNameContext<{ id: string; name: string }>();
