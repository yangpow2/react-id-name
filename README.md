# react-id-name

Efficiently resolve IDs to names in React lists — with batching, caching, and lazy loading.

## Features

- 🚀 **Smart Batching** — Multiple IDs are merged into a single request
- 👁️ **Viewport-aware** — Only fetches when the element is visible
- 💾 **Built-in Cache** — No duplicate requests for the same ID
- ⏰ **Cache TTL** — Optional cache expiration
- 🔄 **Auto Retry** — Click to retry on error
- 🧹 **Cache Control** — Clear or refresh cache programmatically
- 📦 **Tiny** — ~3KB gzipped, only one dependency
- 🎯 **TypeScript** — Full type support with generics
- ♻️ **Reusable** — Create once, use anywhere in your project

## Installation

```bash
npm install react-id-name
# or
yarn add react-id-name
# or
pnpm add react-id-name
```

## Quick Start

```tsx
import { createIdNameContext } from 'react-id-name';

// 1. Create context for your data type
interface UserInfo {
  id: string;
  name: string;
  avatar: string;
}

const { IdNameProvider, IdNameItem } = createIdNameContext<UserInfo>();

// 2. Define your batch fetch function
async function fetchUsers(ids: string[]): Promise<Record<string, UserInfo>> {
  // Option A: If you have a batch API
  const response = await fetch(`/api/users?ids=${ids.join(',')}`);
  const users = await response.json();
  return Object.fromEntries(users.map(u => [u.id, u]));

  // Option B: If you only have single-item API, use Promise.allSettled
  // const results = await Promise.allSettled(
  //   ids.map(id => fetch(`/api/user/${id}`).then(r => r.json()))
  // );
  // return Object.fromEntries(
  //   results
  //     .filter((r): r is PromiseFulfilledResult<UserInfo> => r.status === 'fulfilled')
  //     .map(r => [r.value.id, r.value])
  // );
}

// 3. Wrap your list with Provider
function App() {
  return (
    <IdNameProvider request={fetchUsers}>
      <UserList />
    </IdNameProvider>
  );
}

// 4. Use IdNameItem to display names
function UserList() {
  const userIds = ['user-1', 'user-2', 'user-3'];
  
  return (
    <ul>
      {userIds.map(id => (
        <li key={id}>
          <IdNameItem id={id}>
            {(user) => <span>{user?.name ?? 'Unknown'}</span>}
          </IdNameItem>
        </li>
      ))}
    </ul>
  );
}
```

## Why Factory Pattern?

This library uses a factory pattern (`createIdNameContext`) for three key reasons:

1. **Type Safety** — Each context has its own generic type `T`, so TypeScript knows exactly what data you're working with
2. **Multiple Instances** — You can have separate contexts for users, products, categories, etc., each with isolated caches
3. **Reusability** — Create the context once in a shared file, then import and use it anywhere in your project:

```tsx
// contexts/user.ts
export const { IdNameProvider: UserProvider, IdNameItem: UserItem } = createIdNameContext<User>();

// pages/Home.tsx
import { UserItem } from '@/contexts/user';
<UserItem id={userId}>{(user) => user?.name}</UserItem>

// pages/Profile.tsx  
import { UserItem } from '@/contexts/user';
<UserItem id={userId}>{(user) => user?.avatar}</UserItem>  // Same cache, no duplicate requests!
```

For basic `{ id, name }` data, you can also use the pre-built instance:

```tsx
import { SimpleIdNameProvider, SimpleIdNameItem } from 'react-id-name';

<SimpleIdNameProvider request={fetchNames}>
  <SimpleIdNameItem id="1">{(data) => data?.name}</SimpleIdNameItem>
</SimpleIdNameProvider>
```

## API

### `createIdNameContext<T>()`

Factory function that creates a typed Provider and Item component pair.

```tsx
const { IdNameProvider, IdNameItem, useIdNameCache, IdNameContext } = createIdNameContext<YourDataType>();
```

### `useIdNameCache()`

Hook to access cache control functions. Must be used within an IdNameProvider.

```tsx
const { clearCache, refreshCache } = useIdNameCache();

// Clear specific IDs
clearCache(['user-1', 'user-2']);

// Clear all cache
clearCache();

// Refresh specific IDs (clear and re-fetch when visible)
refreshCache(['user-1']);
```

### `<IdNameProvider>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `request` | `(ids: string[]) => Promise<Record<string, T>>` | **required** | Batch fetch function |
| `debounceTime` | `number` | `80` | Debounce time in ms before batching |
| `cacheTTL` | `number` | - | Cache expiration time in ms (optional) |
| `children` | `ReactNode` | **required** | Child components |

### `<IdNameItem>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | **required** | The ID to resolve |
| `children` | `(data: T \| null, error?: Error) => ReactNode` | **required** | Render function |
| `loading` | `ReactNode` | `...` | Custom loading component |
| `error` | `(error: Error, retry: () => void) => ReactNode` | `⚠` | Custom error component |
| `showChildrenOnError` | `boolean` | `false` | If true, calls children with null on error |
| `className` | `string` | - | Wrapper span className |

## Advanced Usage

### Custom Loading & Error

```tsx
<IdNameItem
  id={userId}
  loading={<Spinner size="small" />}
  error={(err, retry) => (
    <button onClick={retry}>
      Failed: {err.message}. Click to retry
    </button>
  )}
>
  {(user) => <span>{user?.name}</span>}
</IdNameItem>
```

### Fallback to ID on Error or Not Found

```tsx
// Show ID when data is not available
<IdNameItem id={userId}>
  {(user) => <span>{user?.name ?? userId}</span>}
</IdNameItem>

// Or use showChildrenOnError to call children with null on error
<IdNameItem id={userId} showChildrenOnError>
  {(user) => <span>{user?.name ?? `Unknown (${userId})`}</span>}
</IdNameItem>
```

### Multiple Contexts

```tsx
// Create separate contexts for different data types
const { IdNameProvider: UserProvider, IdNameItem: UserItem } = createIdNameContext<User>();
const { IdNameProvider: ProductProvider, IdNameItem: ProductItem } = createIdNameContext<Product>();

function App() {
  return (
    <UserProvider request={fetchUsers}>
      <ProductProvider request={fetchProducts}>
        <MyComponent />
      </ProductProvider>
    </UserProvider>
  );
}
```

### Cache TTL (Auto Expiration)

```tsx
// Cache expires after 5 minutes
<IdNameProvider request={fetchUsers} cacheTTL={5 * 60 * 1000}>
  <UserList />
</IdNameProvider>
```

### Manual Cache Control

```tsx
function RefreshButton() {
  const { clearCache, refreshCache } = useIdNameCache();
  
  return (
    <>
      <button onClick={() => clearCache()}>Clear All Cache</button>
      <button onClick={() => refreshCache(['user-1'])}>Refresh User 1</button>
    </>
  );
}
```

## How It Works

1. When `IdNameItem` enters the viewport, it registers its ID
2. IDs are collected and debounced (default 80ms)
3. A single batch request is made with all collected IDs
4. Results are cached and rendered
5. Subsequent renders use cached data

## License

MIT
