// App version — injected at build time by Vite's `define` from package.json
// (the single source of truth). Declared here so TypeScript knows the global.
declare const __APP_VERSION__: string

export const APP_VERSION = __APP_VERSION__
