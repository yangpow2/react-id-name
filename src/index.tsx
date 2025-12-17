import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
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
  __isProviderMounted: boolean;
}

export interface IdNameProviderProps<T> {
  children: ReactNode;
  /** Batch fetch function: receives an array of IDs, returns a map of id -> data */
  request: (ids: string[]) => Promise<Record<string, T>>;
  /** Debounce time in ms (default: 80) */
  debounceTime?: number;
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
};

type CacheAction<T> =
  | { type: typeof CACHE_ACTION.ADD; payload: CacheMap<T> }
  | { type: typeof CACHE_ACTION.UPDATE; payload: CacheMap<T> };

function cacheReducer<T>(state: CacheMap<T>, action: CacheAction<T>): CacheMap<T> {
  switch (action.type) {
    case CACHE_ACTION.ADD:
      return { ...action.payload, ...state }; // Don't overwrite existing
    case CACHE_ACTION.UPDATE:
      return { ...state, ...action.payload }; // Force update
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
const INIT_STATE: AsyncFnReturn<any> = [{ loading: true, error: undefined, value: undefined, isInit: true }, async () => {}];

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
  }: IdNameProviderProps<T>) => {
    const [cacheMapState, cacheMapDispatch] = useReducer(cacheReducer<T>, {});

    const needUpdateIds = useMemo(
      () => Object.keys(cacheMapState).filter((k) => cacheMapState[k]?.[0]?.isInit),
      [cacheMapState]
    );

    const debouncedNeedUpdateIds = useDebounce(needUpdateIds, debounceTime);

    const batchUpdate = useCallback(
      async (ids: string[]) => {
        // Set loading state
        const loadingStateMap: CacheMap<T> = Object.fromEntries(
          ids.map((id) => [id, INIT_STATE])
        );
        cacheMapDispatch({ type: CACHE_ACTION.UPDATE, payload: loadingStateMap });

        try {
          const resultMap = await request(ids);
          const successStateMap: CacheMap<T> = Object.fromEntries(
            ids.map((id) => [
              id,
              [
                { value: resultMap[id], loading: false, error: undefined },
                async () => batchUpdate([id]),
              ],
            ])
          );
          cacheMapDispatch({ type: CACHE_ACTION.UPDATE, payload: successStateMap });
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          const errorStateMap: CacheMap<T> = Object.fromEntries(
            ids.map((id) => [
              id,
              [
                { value: undefined, loading: false, error },
                async () => batchUpdate([id]),
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

    const onItemView = useCallback((id: string) => {
      cacheMapDispatch({ type: CACHE_ACTION.ADD, payload: { [id]: INIT_STATE } });
    }, []);

    return (
      <IdNameContext.Provider
        value={{
          cacheMapState,
          onItemView,
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

  return {
    IdNameProvider,
    IdNameItem,
    /** The underlying context, for advanced use cases */
    IdNameContext,
  };
}

export default createIdNameContext;
