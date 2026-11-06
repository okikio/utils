import {
	createMcpHandler,
	hostHeaderValidationResponse,
	McpServer,
	originValidationResponse,
} from '@modelcontextprotocol/server';
import * as schema from '@okikio/schema';
import * as http from '@okikio/server/http';

/**
 * Create a local HTTP application that exposes one MCP tool.
 * The caller owns the returned close() operation. Creating this application
 * does not open a network port or authenticate a user.
 */
export function createGreetingMcp() {
	// The SDK creates a fresh protocol server for each HTTP request.
	// Keep durable application state in a separate owner, not this callback.
	const mcp = createMcpHandler(() => {
		const server = new McpServer({ name: 'greetings', version: '1.0.0' });
		// Registration advertises this operation during discovery. Only a call runs
		// the callback; the description helps a client decide when to offer it.
		server.registerTool('greet', {
			description: 'Greet one person.',
			inputSchema: schema.object({ name: schema.string({ minLength: 1, maxLength: 80 }) }),
		}, async ({ name }) => {
			// The SDK checked name before entering this function. Tool replies use
			// protocol content blocks; the SDK turns them into the HTTP response.
			return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
		});
		return server;
	});

	const app = http.create({
		routes: [
			http.mount('/mcp', async (request) => {
				// Refuse unapproved hostnames before the SDK reads a protocol message.
				// These development guards are separate from user authentication.
				const rejected = hostHeaderValidationResponse(request, ['localhost']) ??
					originValidationResponse(request, ['localhost']);
				return rejected ?? mcp.fetch(request);
			}, { requestPath: 'strip-prefix' }),
		],
	});
	return { app, close: () => mcp.close() };
}
