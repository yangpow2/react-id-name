# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1] - 2024-12-17

### Added

- Initial release
- `createIdNameContext` factory function for creating typed Provider and Item components
- Smart batching: multiple IDs merged into single request
- Viewport-aware lazy loading with IntersectionObserver
- Built-in caching to prevent duplicate requests
- Auto retry on error with click-to-retry support
- `showChildrenOnError` option for graceful degradation
- Full TypeScript support with generics
