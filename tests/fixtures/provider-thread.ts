/** A real module Worker serving the shared provider corpus. */
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as worker from '@okikio/activity/worker';
import { Engine, Live } from './provider-contract.ts';
const ctx = context.create({ id: 'native-provider' });
const resources = resource.create(resource.implementations(), { ctx, host: {} });
worker.serve({ engine: Engine, implementations: [Live], resources });
