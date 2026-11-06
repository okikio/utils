import * as problem from '@okikio/http/problem';

/**
 * Framework-owned routing and transport failures. Timeouts, unavailable responses and rejected
 * redirects can occur after the origin has received the request.
 */
export const GatewayProblems: ReturnType<
	typeof problem.catalog<'gateway', {
		readonly NotFound: problem.ProblemDefinition<problem.ProblemExtensionContract | undefined, 404>;
		readonly InvalidRequest: problem.ProblemDefinition<problem.ProblemExtensionContract | undefined, 400>;
		readonly BodyTooLarge: problem.ProblemDefinition<problem.ProblemExtensionContract | undefined, 413>;
		readonly DeadlineExceeded: problem.ProblemDefinition<problem.ProblemExtensionContract | undefined, 504>;
		readonly InvalidRedirect: problem.ProblemDefinition<problem.ProblemExtensionContract | undefined, 502>;
		readonly Unavailable: problem.ProblemDefinition<problem.ProblemExtensionContract | undefined, 503>;
		readonly Internal: problem.ProblemDefinition<problem.ProblemExtensionContract | undefined, 500>;
	}>
> = problem.catalog('gateway', {
	NotFound: problem.define({
		id: 'gateway:not-found',
		type: 'urn:utils:gateway:not-found',
		status: 404,
		title: 'Route not found',
		description: 'The gateway does not own the requested method and path.',
	}),
	InvalidRequest: problem.define({
		id: 'gateway:invalid-request',
		type: 'urn:utils:gateway:invalid-request',
		status: 400,
		title: 'Invalid request',
		description: 'The request contains malformed transport metadata.',
	}),
	BodyTooLarge: problem.define({
		id: 'gateway:body-too-large',
		type: 'urn:utils:gateway:body-too-large',
		status: 413,
		title: 'Request body too large',
		description: 'The request body exceeds the configured gateway limit.',
	}),
	DeadlineExceeded: problem.define({
		id: 'gateway:deadline-exceeded',
		type: 'urn:utils:gateway:deadline-exceeded',
		status: 504,
		title: 'Gateway timeout',
		description: 'The origin did not complete before the gateway deadline.',
	}),
	InvalidRedirect: problem.define({
		id: 'gateway:invalid-redirect',
		type: 'urn:utils:gateway:invalid-redirect',
		status: 502,
		title: 'Invalid upstream redirect',
		description: 'The origin returned a redirect location forbidden by gateway policy.',
	}),
	Unavailable: problem.define({
		id: 'gateway:unavailable',
		type: 'urn:utils:gateway:unavailable',
		status: 503,
		title: 'Service unavailable',
		description: 'The selected origin is currently unavailable.',
	}),
	Internal: problem.define({
		id: 'gateway:internal',
		type: 'urn:utils:gateway:internal',
		status: 500,
		title: 'Internal gateway error',
		description: 'The gateway encountered an unexpected internal failure.',
		exposure: 'internal',
	}),
});
