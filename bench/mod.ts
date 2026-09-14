/** Register and execute the cross-package benchmark stories. */
import { run } from 'mitata';

import './coordination.bench.ts';
import './discovery.bench.ts';
import './http.bench.ts';
import './workflow.bench.ts';

await run();
