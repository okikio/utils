/** Register and execute the cross-package benchmark stories. */
import { run } from '#tools/bench/run.ts';

import '#bench/coordination.bench.ts';
import '#bench/discovery.bench.ts';
import '#bench/http.bench.ts';
import '#bench/workflow.bench.ts';

await run();
