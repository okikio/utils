/** Authored observations from the pinned upstream suites, independent of either candidate. @module */
export interface SourceType {
	readonly path: string;
	readonly line: number;
	readonly title: string;
}

export interface MatchType {
	readonly handler: string;
	readonly params: Readonly<Record<string, string>>;
}

export interface RouterCaseType {
	readonly id: string;
	readonly source: SourceType;
	readonly routes: readonly (readonly [method: string, path: string, handler: string])[];
	readonly method: string;
	readonly path: string;
	readonly expected: readonly MatchType[];
	readonly utilsExpected?: readonly MatchType[] | 'registration-rejected';
	readonly difference?: string;
}

export interface RequestCaseType {
	readonly id: string;
	readonly source: SourceType;
	readonly operation:
		| 'query'
		| 'headers'
		| 'headers-prototype'
		| 'headers-prototype-injected'
		| 'body-cache'
		| 'form'
		| 'non-form'
		| 'nonform-invalid'
		| 'clone'
		| 'consumed-clone'
		| 'multipart-clone'
		| 'multipart-stale-clone'
		| 'external-cache-clone'
		| 'clone-get'
		| 'raw-consumed-clone';
	readonly url?: string;
	readonly body?: string;
	readonly bodyKind?: 'text' | 'bytes' | 'blob';
	readonly headers?: Readonly<Record<string, string>>;
	readonly keys?: readonly string[];
	readonly order?: readonly ('text' | 'json' | 'arrayBuffer' | 'bytes' | 'blob')[];
	readonly expected: unknown;
	readonly utilsExpected?: unknown;
	readonly adaptation?: string;
	readonly difference?: string;
}

export interface ResponseCaseType {
	readonly id: string;
	readonly source: SourceType;
	readonly operation:
		| 'text'
		| 'json'
		| 'html'
		| 'async-html'
		| 'body'
		| 'redirect'
		| 'replace'
		| 'response-init'
		| 'replace-cookie'
		| 'compose-cookie'
		| 'init-cookie';
	readonly body?: string | Readonly<Record<string, string>> | null;
	readonly status?: 200 | 201 | 204 | 400 | 401 | 404;
	readonly before?: readonly (readonly [name: string, value: string | readonly string[] | null, append?: boolean])[];
	readonly headers?: Readonly<Record<string, string | readonly string[]>>;
	readonly location?: string;
	readonly original?: {
		readonly body: string;
		readonly status: 200 | 401;
		readonly headers: Readonly<Record<string, string>>;
	};
	readonly expected: ResponseObservationType;
	readonly adaptation?: string;
}

export interface ResponseObservationType {
	readonly status?: number;
	readonly body?: string;
	readonly headers?: Readonly<Record<string, string | null>>;
	readonly mediaType?: string;
	readonly cookies?: readonly string[];
	readonly cookieMembership?: Readonly<Record<string, boolean>>;
	readonly bodyMissing?: boolean;
}

export interface ApplicationCaseType {
	readonly id: string;
	readonly source: SourceType;
	readonly application: ApplicationType;
	readonly path: string;
	readonly method?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly expected: ResponseObservationType;
	readonly utilsExpected?: ResponseObservationType;
	readonly difference?: string;
	readonly adaptation?: string;
}

export type ApplicationType =
	| 'encoded-param'
	| 'encoded-static'
	| 'encoded-invalid'
	| 'encoded-posts'
	| 'parameters'
	| 'path'
	| 'methods'
	| 'middleware'
	| 'chained'
	| 'multiple'
	| 'replacement'
	| 'missing'
	| 'missing-one'
	| 'missing-two'
	| 'error'
	| 'async-error'
	| 'missing-error'
	| 'mount'
	| 'mount-api'
	| 'mount-unicode'
	| 'mount-slash'
	| 'mount-percent'
	| 'head'
	| 'strict'
	| 'strict-slash'
	| 'loose';

/** Inspect only fields asserted upstream; consume every response, including header-only observations. */
export async function observe(response: Response, fields: ResponseObservationType): Promise<ResponseObservationType> {
	const bodyMissing = response.body === null;
	const body = await response.text();
	return {
		...('status' in fields ? { status: response.status } : {}),
		...('body' in fields ? { body } : {}),
		...('headers' in fields
			? {
				headers: Object.fromEntries(Object.keys(fields.headers!).map((name) => [name, response.headers.get(name)])),
			}
			: {}),
		...('mediaType' in fields ? { mediaType: response.headers.get('content-type')?.split(';')[0] } : {}),
		...('cookies' in fields ? { cookies: response.headers.getSetCookie() } : {}),
		...('cookieMembership' in fields
			? {
				cookieMembership: Object.fromEntries(
					Object.keys(fields.cookieMembership!).map((
						cookie,
					) => [cookie, response.headers.getSetCookie().includes(cookie)]),
				),
			}
			: {}),
		...('bodyMissing' in fields ? { bodyMissing } : {}),
	};
}
