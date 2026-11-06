/** Start the Deno host; Ctrl+C closes its accepted sockets before returning. @module */
import { listen } from './server.ts';
const host = listen();
console.log(host.url.href);
Deno.addSignalListener('SIGINT', async () => {
	await host.close();
	Deno.exit();
});
