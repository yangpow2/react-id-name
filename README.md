# react-id-name

Efficiently resolve IDs to names in React lists — with batching, caching, and lazy loading.

## Features

- 🚀 **Smart Batching** — Multiple IDs are merged into a single request
- 👁️ **Viewport-aware** — Only fetches when the element is visible
- 💾 **Built-in Cache** — No duplicate requests for the same ID
- 🔄 **Auto Retry** — Click to retry on error
- 📦 **Tiny** — ~2KB gzipped, only one dependency
- 🎯 **TypeScript** — Full type support with generics

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
  const response = await fetch(`/api/users?ids=${ids.join(',')}`);
  const users = await response.json();
  // Return a map of id -> data
  return Object.fromEntries(users.map(u => [u.id, u]));
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

## API

### `createIdNameContext<T>()`

Factory function that creates a typed Provider and Item component pair.

```tsx
const { IdNameProvider, IdNameItem, IdNameContext } = createIdNameContext<YourDataType>();
```

### `<IdNameProvider>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `request` | `(ids: string[]) => Promise<Record<string, T>>` | **required** | Batch fetch function |
| `debounceTime` | `number` | `80` | Debounce time in ms before batching |
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

## How It Works

1. When `IdNameItem` enters the viewport, it registers its ID
2. IDs are collected and debounced (default 80ms)
3. A single batch request is made with all collected IDs
4. Results are cached and rendered
5. Subsequent renders use cached data

## License

MIT
