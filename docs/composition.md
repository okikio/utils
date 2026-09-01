# Composition

The monorepo keeps generic mechanisms small and directional. Leaf packages may depend on other focused utility contracts, while the `@okikio/utils` package sits at the top as an installation convenience.

```text
application / library
        |
        +--> @okikio/utils/<capability>
        |          |
        |          +--> focused @okikio/* dependencies
        |
        `--> @okikio/<capability>
```

The umbrella is not a second implementation. Every subpath is a re-export of one leaf package. Fixes therefore land once, in the package that owns the behavior.

## Runtime ownership

Root and runtime-neutral entrypoints should remain import-safe. Runtime-specific adapters such as Deno, Node, Hono, process, and worker entrypoints stay explicit so browser or server consumers do not load unrelated host integrations accidentally.

## Choosing an import

Use `@okikio/utils/<name>` when the project wants one installation declaration but still wants focused imports. Use `@okikio/<name>` when the project deliberately wants a minimal dependency declaration. Use `@okikio/utils/all` only at composition roots that intentionally need broad namespace access.
