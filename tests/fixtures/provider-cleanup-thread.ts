/** Native Worker entry; only the runtime adapter differs, never the activity implementation. @module */
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as worker from '@okikio/activity/worker';
import { Engine, Live } from './provider-cleanup.ts';
const ctx = context.create({ id: 'cleanup-native' });
const resources = resource.create(resource.implementations(), { ctx, host: {} });
// The parent explicitly starts node:worker_threads, including its Deno/Bun compatibility implementation.
const scope = (await import('@okikio/runtime/node/worker')).scope();
worker.serve({ engine: Engine, implementations: [Live], resources, scope });
