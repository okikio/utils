/** Run the loopback example until the operator requests shutdown. */
import process from 'node:process';
import { listen } from './listen.ts';
const host = await listen();
console.log(`MCP tools are available at ${host.url}`);
// Stop receiving requests before closing protocol resources. A forced OS kill
// can still skip cleanup, so this listener owns no durable application state.
await new Promise<void>((resolve) => process.once('SIGINT', resolve));
await host.close();
