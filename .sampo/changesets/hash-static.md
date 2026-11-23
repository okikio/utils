---
npm/@okikio/hash: minor
npm/@okikio/utils: minor
---

Add `@okikio/hash/<family>/static` for hosts that allow only statically analyzable imports and refuse to compile WebAssembly at runtime, such as Cloudflare Workers. Import the family's `.wasm` file with your bundler (Wrangler and the Cloudflare Vite plugin turn it into a `WebAssembly.Module`) and pass it to `ready()`. The entry point has no `import()`, `import.meta`, `fetch`, embedded module or runtime compile, and refuses bytes and URLs. The default family paths stay dynamic and unchanged. They now look up `node:crypto` on first use instead of at import.
