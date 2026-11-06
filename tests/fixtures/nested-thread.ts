/** Actual Node thread; its Activity server borrows this host-owned collection. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as worker from '@okikio/activity/worker';
import * as native from '@okikio/runtime/node/worker';
import { Engine, Live, StateLive } from './nested-contract.ts';
await using owner = context.create({ id: 'nested-thread' });
await using resources = resource.create(resource.implementations(StateLive), { ctx: owner, host: {} });
using scope = native.scope();
await using server = worker.serve({ engine: Engine, implementations: [Live], resources, scope });
await server.closed;
