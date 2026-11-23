/**
 * Container images the tests start, pinned by digest. This file is the one owner of these
 * references: tests import them, and CI pulls and caches exactly this list before the Docker lanes
 * run (`node tests/fixtures/images.ts` prints it).
 *
 * A digest pins the bytes, so a cached image can never differ from the one a test asks for. To
 * update an image, change its tag and digest here.
 * @module
 */
import process from 'node:process';

/** PostgreSQL for the durable workflow, queue and failover tests. */
export const Postgres = 'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db';

/** Node.js for workers and HTTP services that run inside a container. */
export const Node =
	'node:26.10.0-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3';

/** nginx for the reverse proxy and stream buffering tests. */
export const Nginx = 'nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236';

/**
 * Ryuk, the testcontainers sidecar that removes containers when a test process dies. CI sets
 * `RYUK_CONTAINER_IMAGE` to this value, so testcontainers starts the cached image instead of its
 * own default tag.
 */
export const Ryuk =
	'testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0';

/** Every image above, in a stable order for the CI cache key. */
export const Images = [Postgres, Node, Nginx, Ryuk] as const;

if (import.meta.main) process.stdout.write(`${Images.join('\n')}\n`);
