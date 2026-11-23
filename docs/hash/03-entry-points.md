# Entry points

Status: proposed. Read [Backends](01-backends.md) first.

An import path selects two things: which algorithms you can call (the **family**) and how they run (the **backend**).
Most code imports a family and lets the default choose the backend.

```ts
import { sha3_256 } from '@okikio/hash/sha3';

console.log(await sha3_256('hello'));
```

## Family entry points

Each family path exports the family's algorithms, their HMAC forms and `ready()`.

| Path                         | Family                                        |
| ---------------------------- | --------------------------------------------- |
| `@okikio/hash`            | `sha2`, `id`, `hex` (no change from today)    |
| `@okikio/hash/sha2`       | SHA-2                                         |
| `@okikio/hash/sha3`       | SHA-3, Keccak, SHAKE, cSHAKE, TurboSHAKE, K12, KMAC |
| `@okikio/hash/blake`      | BLAKE2, BLAKE3                                |
| `@okikio/hash/legacy`     | MD2, MD4, MD5, SHA-1, SHA-1 checked, RIPEMD, Tiger |
| `@okikio/hash/national`   | Streebog, GOST94, SM3, Kupyna, BelT, bash, Ascon |
| `@okikio/hash/contest`    | Grøstl, JH, Skein, Shabal, Whirlpool          |
| `@okikio/hash/fsb`        | FSB                                           |
| `@okikio/hash/mac`        | SipHash, HighwayHash                          |
| `@okikio/hash/fast`       | xxHash, rapidhash, SeaHash, FNV-1a            |
| `@okikio/hash/checksum`   | CRC catalogue, Adler-32, Fletcher-16          |
| `@okikio/hash/digest`     | `digest(name, input)` for any family; loads the family on first use |

`digest` with a name string must be able to reach every family, so it loads families with dynamic `import()`. A
bundler then emits one chunk per family. Prefer a family path when you know the algorithm at build time.

## Backend entry points

Add a backend after the family to force it. The default is the automatic choice.

| Suffix       | Example                              | Behavior                                                   |
| ------------ | ------------------------------------ | ---------------------------------------------------------- |
| (none)       | `@okikio/hash/sha3`               | Automatic choice ([rules](01-backends.md#how-the-default-chooses)) |
| `/packed`    | `@okikio/hash/sha3/packed`        | Embedded WASM only                                          |
| `/wasm`      | `@okikio/hash/sha3/wasm`          | Separate `.wasm` file only; you pass the module, or `ready()` fetches it ([below](#load-the-wasm-yourself)) |
| `/static`    | `@okikio/hash/sha3/static`        | A compiled module you import; nothing resolved, fetched or compiled at runtime ([below](#static-imports)) |
| `/native`    | `@okikio/hash/sha2/native`        | `node:crypto` only; throws `UnsupportedError` without it    |
| `/web`       | `@okikio/hash/sha2/web`           | Web Crypto only; asynchronous functions only               |
| `/portable`  | `@okikio/hash/sha3/portable`      | Pure JavaScript only: `@noble/hashes`, and the package's own CRC-32 |
| `/shared`    | `@okikio/hash/blake/shared`       | WASM with shared memory and a worker pool; see below       |

A forced backend never falls back. That is the point of forcing it: a test or an audit can prove which code ran.

`/native`, `/web` and `/portable` exist only for families that have an implementation in that backend, and each takes
only the algorithm names that backend runs, as its `AlgorithmType`. The [algorithm tables](02-algorithms.md) show
which. They are:

| Suffix      | Families                                                    |
| ----------- | ----------------------------------------------------------- |
| `/native`   | `sha2`, `sha3`, `blake`, `legacy`, `national` (SM3)          |
| `/web`      | `sha2` (SHA-256, SHA-384, SHA-512), `legacy` (SHA-1)        |
| `/portable` | `sha2`, `sha3`, `blake`, `legacy`, `checksum` (CRC-32, CRC-32C) |

`/wasm`, `/packed` and `/static` exist for all ten families. `/web` has no `create`, because Web Crypto has no incremental state.

## Load the WASM yourself

The `/wasm` entry point never loads anything until you call `ready()`. You can give it the module in any form you
already have, and then it does no fetch and no file read:

| You pass                                        | Where it comes from                                         |
| ----------------------------------------------- | ----------------------------------------------------------- |
| The exports object                              | `import * as sha3 from './vendor/sha3.wasm'` (WASM ESM integration, a copy of the shipped file) |
| A `WebAssembly.Module`                          | `import source sha3 from './vendor/sha3.wasm'` (source phase import), or your own `compileStreaming` |
| A `WebAssembly.Instance`                        | Your own `instantiate` call                                  |
| A `Response` or a promise of one                | Your own `fetch`, for example from a CDN with integrity metadata |
| `Uint8Array` or `ArrayBuffer`                   | A file read, a cache or a bundler's binary loader            |
| A `URL` or string                               | Fetched with `WebAssembly.instantiateStreaming`             |
| Nothing                                         | Fetched from the file beside the module, found with `import.meta.url` |

```ts
import * as module from './vendor/sha3.wasm';
import { ready, sha3_256 } from '@okikio/hash/sha3/wasm';

await ready(module);
console.log(await sha3_256('hello'));
```

This works because every module has no imports and exports its own memory. A host that supports WASM ESM integration
can instantiate it with no glue code. The raw files are package exports, `@okikio/hash/wasm/<family>.wasm`, on JSR and npm. The
`@okikio/utils` umbrella does not re-export them, because a `.wasm` file is not a module it can forward; import them
from `@okikio/hash`.

Host support checked locally: Deno 2.9 runs both the instance import and `import source`. Node.js 22 runs the instance
import behind `--experimental-wasm-modules` and does not parse `import source`. Bun 1.4 runs neither. Browsers need a
bundler for both forms today. Because support differs, the automatic default keeps packed WASM, and the forms above are
choices you make.

## Static imports

Status: built.

Some hosts accept only imports a bundler can see, and refuse to compile WebAssembly at runtime. Cloudflare Workers
is the main one: `WebAssembly.compile`, `instantiate` with bytes and the streaming forms all throw there, and only
`instantiate` with an already compiled module works. The module must come from a `.wasm` import, which Wrangler and
the Cloudflare Vite plugin turn into a `WebAssembly.Module`.

The default stays dynamic. `/static` is an opt-in entry point for each family:

```ts ignore
import wasm from '@okikio/hash/wasm/sha3.wasm';
import { hash, ready } from '@okikio/hash/sha3/static';

await ready(wasm);
hash('sha3-256', 'hello');
```

What `/static` guarantees, checked by `static.test.ts` over each entry's import graph:

- no `import()`, no `import.meta`, no `fetch` and no `WebAssembly.compile` or `instantiateStreaming`;
- no embedded module (`_wasm/packed/`), no full loader (`_wasm/load.ts`) and no `node:crypto` lookup.

It uses `_runtime.ts` with the compiled-only loader `_wasm/attach.ts`; every other entry uses `_family.ts`, which
adds the full loader. `ready()` takes a `WebAssembly.Module`, an instance, a WASM ESM import's exports or a namespace
whose `default` is one of these, and refuses bytes and URLs. Nothing falls back.

There is no single `.wasm` import syntax for every host, so the application writes the import, not the package. A
default import gives a `Module` under Wrangler and Vite. `import source` gives one in Deno and in Node.js 24 or later
behind `--experimental-wasm-modules`, but esbuild cannot bundle that form. Pick the form your toolchain uses.

For `fast`, import `fast.wasm` (any host) or `fast-wide.wasm` (hosts with wide arithmetic); both give the same
digests. `digest` loads families by name with `import()`, which bundlers handle when the specifier is a literal; on a
static host, import the family's `/static` path instead. `/shared` needs `Worker`, which Workers do not have.

The default paths still run on Workers: the packed compile fails once, the failure is recorded, and calls move to
`node:crypto` (with `nodejs_compat`) or pure JavaScript. Algorithms with neither, such as Streebog, need `/static`.

## Encoding entry points

Encodings are not hashes, but hash results are often encoded. Each has its own path, so a page that only needs Base64
does not load anything else.

| Path                        | Exports                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `@okikio/hash/base64`    | `base64`, `unbase64`, `base64url`, `unbase64url`               |
| `@okikio/hash/hex`       | `hex`, `unhex`                                                  |
| `@okikio/hash/encoding`  | All of the above (no change from today)                        |

These use `Uint8Array.prototype.toBase64`, `Uint8Array.fromBase64`, `toHex` and `fromHex` when the host has them
(Chrome 140+, Firefox 133+, Safari 18.2+, Deno, Bun). Node.js 22 does not, so they fall back to `@std/encoding`. Both
paths enforce the same strict rules as today: canonical padding, no whitespace, no mixed alphabets.

## Shared memory and workers

`/shared` runs a family on a pool of workers. Each worker loads the family entry point, so it runs the same WASM module
and, for SHA-1 and SHA-2, the same `node:crypto` choice as the calling thread.

```ts
import * as context from '@okikio/context';
import { open } from '@okikio/hash/blake/shared';

await using ctx = context.create({ id: 'hashes' });
await using pool = open(ctx, { workers: 4 });
const digests = await pool.many(ctx, 'blake3', files); // one digest per input, in order
```

The pool is built on `@okikio/worker/thread`: the request and response are schema-checked, `ctx` owns the workers
and each call's `ctx` can cancel that call. `many()` splits the inputs into one contiguous batch per worker, balanced by
bytes. A batch crosses the boundary as one buffer and an array of offsets, and its digests come back end to end in one
transferred buffer. Thousands of small inputs cost two messages, not thousands. When every input is a view of one
`SharedArrayBuffer`, that buffer is sent as it is and nothing is copied. Otherwise the inputs are copied once into new
shared memory, or into an `ArrayBuffer` that is transferred where the host has no `SharedArrayBuffer`.

What it speeds up: many independent inputs, and a few large ones. What it does not: one input of a sequential hash.
Each block of SHA-2, SHA-3 or MD5 depends on the one before it.

### Why not WebAssembly threads

The design first planned one module on one shared `WebAssembly.Memory`, with every worker instantiating it. That does
not build on stable Rust. `wasm32-unknown-unknown` ships `core` without the atomics feature, and the linker refuses
`--shared-memory`:

```text
rust-lld: error: --shared-memory is disallowed by core-….rcgu.o because it was not compiled with 'atomics' or
'bulk-memory' features.
```

The `wasm32-wasip1-threads` target ships `core` with atomics and does link a module that imports shared memory. But
the module's input window, state table and stack would then be one region that every worker writes. Separating them
needs per-thread storage, which is unstable in Rust (`#[thread_local]`), or an ABI that passes a lane to every call
and a stack pointer set per instance. Both add `unsafe` code and a second build of every family. They would also save
little: a worker still copies input into its module memory, which is what a pool with its own memory per worker does.

### One large BLAKE3 input

BLAKE3 is a binary tree of 1024-byte chunks, so `pool.hash()` splits an input of 1 MiB or more into one subtree per
worker. The split follows `left_subtree_len` from `blake3::hazmat`, so each subtree starts at a multiple of its own
size. Workers return chaining values, and the calling thread merges them up the tree. The `blake` module has three
internal ids for this (18 subtree, 19 merge, 20 root merge), built on `blake3::hazmat` in `wasm/blake/src/tree.rs`.
Plain, keyed and derive-key modes and any output length give the same digest as one pass, which `shared.test.ts`
checks.

KangarooTwelve is also a tree hash, but the `k12` crate has no subtree API, so it is not split.

## Wide-arithmetic builds

The WASM [wide-arithmetic](https://github.com/WebAssembly/wide-arithmetic) feature adds 64×64→128-bit multiply and
128-bit add instructions. xxHash and rapidhash use 128-bit multiplies. [Measurements](04-measurements.md#wide-arithmetic)
show rapidhash 5–7 times faster on large inputs and XXH3 up to 2.6 times faster on 64-byte inputs.

Firefox 155 and Bun ship the feature. V8 (Chrome, Node.js, Deno) has it behind a flag. Playwright's WebKit 27.2
accepts it; shipping Safari did not when this was written. So the
`fast` family ships two modules, `fast.wasm` and `fast-wide.wasm`. `ready()` calls `WebAssembly.validate` on a 34-byte
probe module once (`_wasm/wide.ts`) and loads the wide module only when the host accepts it. `@okikio/hash/fast`,
`/fast/packed` and `/fast/wasm` all choose this way; the packed text of the other build is never loaded. Both modules
give the same results, which `wasm.test.ts` checks on every host that has the feature.

Other families do not benefit, so they ship one module.

## Features the package does not use

| WASM or JS feature       | Why not                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| Relaxed SIMD             | The hash crates do not emit relaxed instructions, and Safari does not support it. |
| memory64                 | Inputs are streamed through a 64 KiB window. 64-bit addresses only add bounds-check cost. |
| Multiple memories        | One memory is enough. Rust does not target multiple memories.                    |
| JS string builtins       | Would let WASM read a JS string without `TextEncoder`. Stable Rust cannot import `externref` builtins without `wasm-bindgen`, and `encodeInto` already runs at memory speed. |
| Source phase imports as the default | `ready()` accepts the result of `import source` ([above](#load-the-wasm-yourself)). The default does not use it until every target host supports it. |
