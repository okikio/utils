/** Point Neon's serverless driver at the target's proxy, shared by the Neon clients. @module */
import type { StartedType } from '../../targets/types.ts';

/** Point Neon's driver at the local proxy. The settings are global; every Neon client sets the same ones. */
export async function neonDriver(started: StartedType) {
	if (!started.neon) throw new Error('This target has no Neon proxy.');
	const neon = await import('@neondatabase/serverless');
	const { default: ws } = await import('ws');
	const endpoints = started.neon;
	neon.neonConfig.fetchEndpoint = () => endpoints.http;
	neon.neonConfig.wsProxy = () => endpoints.ws;
	neon.neonConfig.useSecureWebSocket = false;
	neon.neonConfig.pipelineTLS = false;
	neon.neonConfig.pipelineConnect = false;
	neon.neonConfig.webSocketConstructor = ws;
	return { neon, connection: endpoints.connection };
}
