/** Explicit Node collection. LogTape configuration remains application-owned. SDKs load only when open is called. @module */
import { AsyncLocalStorage } from 'node:async_hooks';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import type { Sink } from '@logtape/logtape';
import type { Instrument } from './instrument.ts';
import { create as instrumentation } from './otel/instrument.ts';

/** Collection policy. Durations are milliseconds; endpoint is the OTLP HTTP base URL. */
export interface Options {
	/** Required non-empty service name shared by logs, traces, and metrics. */
	readonly service: string;
	/** HTTP or HTTPS base URL. Signal paths are appended; credentials belong in headers. */
	readonly endpoint: string;
	/** Optional deployed revision and environment. Neither is read from application configuration. */
	readonly version?: string;
	readonly environment?: string;
	/** Explicit collector authentication. Values are copied at startup. */
	readonly headers?: Readonly<Record<string, string>>;
	/** Root sampling probability, 0..1. Defaults to 0.1; parent decisions are respected. False disables traces. */
	readonly traces?: false | { readonly sample?: number };
	/** Collection interval, 1000..3600000. Defaults to 10000. False disables metrics. */
	readonly metrics?: false | { readonly interval?: number };
	/** Maximum buffered logs and completed spans per signal, 1..65536. Defaults to 2048. */
	readonly capacity?: number;
	/** Total flush/shutdown deadline, 1..60000. Defaults to 5000. */
	readonly shutdown?: number;
	/** Observe export and shutdown errors. Throwing here cannot fail application work. */
	readonly onError?: (error: unknown) => void;
}

/** Own providers until application work stops and LogTape has been reset. */
export interface Collection extends AsyncDisposable {
	/** Borrowed LogTape sink. Resetting LogTape does not close these providers. */
	readonly sink: Sink;
	/** Inject this borrowed instrument into execution contexts, clients, stores, and hosts. */
	readonly instrument: Instrument;
	/** Supply to LogTape's contextLocalStorage option for correlated application logs. */
	readonly storage: AsyncLocalStorage<Record<string, unknown>>;
	/** Number of observed export/shutdown errors, without retaining arbitrary diagnostic values. */
	readonly errors: number;
	/** Flush and close once. Export failures are reported through onError; the deadline bounds this wait. */
	close(): Promise<void>;
}

/** Prevent two concurrent starts even while optional SDK imports are pending. No work starts during import. */
let owned = false;

/**
 * Start one process-wide collection owner. This never configures LogTape or starts an application worker.
 * Register only previously unowned OpenTelemetry APIs; conflicting setup fails without replacing its owner.
 * A reachable collector is not a readiness requirement. Configure LogTape next, then start application work.
 */
export async function open(options: Options): Promise<Collection> {
	const endpoint = new URL(options.endpoint);
	if (
		!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search ||
		endpoint.hash
	) {
		throw new TypeError('Telemetry endpoint must be an HTTP(S) base URL without credentials, query, or fragment.');
	}
	if (typeof options.service !== 'string' || !options.service.trim() || options.service.length > 256) {
		throw new TypeError('Telemetry service must contain 1..256 characters.');
	}
	const sample = options.traces === false ? 0 : options.traces?.sample ?? 0.1;
	if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new RangeError('Trace sample must be 0..1.');
	const capacity = integer(options.capacity ?? 2048, 1, 65536, 'capacity');
	const shutdown = integer(options.shutdown ?? 5000, 1, 60000, 'shutdown');
	const interval = integer(
		options.metrics === false ? 10000 : options.metrics?.interval ?? 10000,
		1000,
		3600000,
		'interval',
	);
	if (options.onError !== undefined && typeof options.onError !== 'function') {
		throw new TypeError('onError must be a function.');
	}
	const headers = { ...options.headers };
	const service = options.service;
	const version = options.version;
	const environment = options.environment;
	const tracing = options.traces !== false;
	const measuring = options.metrics !== false;
	const onError = options.onError;
	if (owned) throw new Error('Telemetry collection is already open in this process.');
	owned = true;
	const storage = new AsyncLocalStorage<Record<string, unknown>>();
	const closers: Array<() => Promise<void>> = [];
	const unregister: Array<() => void> = [];
	let errors = 0;
	const report = (error: unknown): void => {
		errors += 1;
		try {
			onError?.(error);
		} catch { /* Diagnostic observers have no authority over application results. */ }
	};
	const url = (signal: string): string => `${endpoint.href.replace(/\/$/, '')}/v1/${signal}`;
	try {
		const [resources, spans, node, meters, logs, traceExport, metricExport, logExport, logtape, hooks, core] =
			await Promise.all([
				import('@opentelemetry/resources'),
				import('@opentelemetry/sdk-trace-base'),
				import('@opentelemetry/sdk-trace-node'),
				import('@opentelemetry/sdk-metrics'),
				import('@opentelemetry/sdk-logs'),
				import('@opentelemetry/exporter-trace-otlp-http'),
				import('@opentelemetry/exporter-metrics-otlp-http'),
				import('@opentelemetry/exporter-logs-otlp-http'),
				import('@logtape/otel'),
				import('@opentelemetry/context-async-hooks'),
				import('@opentelemetry/core'),
			]);
		const resource = resources.resourceFromAttributes({
			'service.name': service,
			...(version === undefined ? {} : { 'service.version': version }),
			...(environment === undefined ? {} : { 'deployment.environment.name': environment }),
		});
		const batch = {
			maxQueueSize: capacity,
			maxExportBatchSize: Math.min(512, capacity),
			exportTimeoutMillis: shutdown,
		};
		if (tracing) {
			const exporter = watch(
				new traceExport.OTLPTraceExporter({ url: url('traces'), headers, timeoutMillis: shutdown }),
				report,
			);
			const provider = new node.NodeTracerProvider({
				resource,
				sampler: new spans.ParentBasedSampler({ root: new spans.TraceIdRatioBasedSampler(sample) }),
				spanProcessors: [new spans.BatchSpanProcessor(exporter, batch)],
				spanLimits: { attributeCountLimit: 32, attributeValueLengthLimit: 512 },
			});
			closers.push(() => provider.shutdown());
			if (!trace.setGlobalTracerProvider(provider)) {
				throw new Error('An OpenTelemetry tracer provider is already registered.');
			}
			unregister.push(() => trace.disable());
			if (!propagation.setGlobalPropagator(new core.W3CTraceContextPropagator())) {
				throw new Error('An OpenTelemetry propagator is already registered.');
			}
			unregister.push(() => propagation.disable());
		}
		const manager = new hooks.AsyncLocalStorageContextManager().enable();
		closers.push(async () => {
			manager.disable();
		});
		if (!context.setGlobalContextManager(manager)) {
			throw new Error('An OpenTelemetry context manager is already registered.');
		}
		unregister.push(() => context.disable());
		if (measuring) {
			const exporter = watch(
				new metricExport.OTLPMetricExporter({ url: url('metrics'), headers, timeoutMillis: shutdown }),
				report,
			);
			const provider = new meters.MeterProvider({
				resource,
				readers: [
					new meters.PeriodicExportingMetricReader({
						exporter,
						exportIntervalMillis: interval,
						exportTimeoutMillis: Math.min(shutdown, interval),
					}),
				],
			});
			closers.push(() => provider.shutdown({ timeoutMillis: shutdown }));
			if (!metrics.setGlobalMeterProvider(provider)) {
				throw new Error('An OpenTelemetry meter provider is already registered.');
			}
			unregister.push(() => metrics.disable());
		}
		const exporter = watch(
			new logExport.OTLPLogExporter({ url: url('logs'), headers, timeoutMillis: shutdown }),
			report,
		);
		const provider = new logs.LoggerProvider({
			resource,
			processors: [new logs.BatchLogRecordProcessor(exporter, batch)],
			logRecordLimits: { attributeCountLimit: 32, attributeValueLengthLimit: 512 },
		});
		closers.push(() => provider.shutdown());
		const destination = logtape.getOpenTelemetrySink({ loggerProvider: provider });
		// Borrow the native sink's emission only. The collection, not LogTape, owns provider shutdown.
		const sink: Sink = (record) => destination(record);
		const instrument = instrumentation({ maximumPending: capacity });
		let closing: Promise<void> | undefined;
		/** One collection owns global registration; repeated disposal shares its shutdown receipt. */
		const close = (): Promise<void> => closing ??= finish();
		const finish = async (): Promise<void> => {
			for (const remove of unregister.toReversed()) remove();
			storage.disable();
			await release([...closers, () => instrument.flush()], shutdown, report);
			owned = false;
		};
		return Object.freeze({
			sink,
			instrument,
			storage,
			get errors() {
				return errors;
			},
			close,
			[Symbol.asyncDispose]: close,
		});
	} catch (error) {
		for (const remove of unregister.toReversed()) remove();
		storage.disable();
		await release(closers, shutdown, report);
		owned = false;
		throw error;
	}
}

/** Track exporter completion errors without changing the SDK's callback or lifecycle contract. */
function watch<
	Items,
	Result extends { readonly code: number; readonly error?: Error },
	Exporter extends {
		export(items: Items, callback: (result: Result) => void): void;
	},
>(exporter: Exporter, report: (error: unknown) => void): Exporter {
	const send = exporter.export.bind(exporter);
	exporter.export = (items, callback) =>
		send(items, (result) => {
			if (result.code !== 0) report(result.error ?? new Error('Telemetry export failed.'));
			callback(result);
		});
	return exporter;
}

/** Join every shutdown and report a single shared deadline. Late rejections remain observed. */
async function release(
	closers: readonly (() => Promise<void>)[],
	timeout: number,
	report: (error: unknown) => void,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.all(
				closers.toReversed().map(async (close) => {
					try {
						await close();
					} catch (error) {
						report(error);
					}
				}),
			),
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					report(new Error('Telemetry shutdown deadline exceeded.'));
					resolve();
				}, timeout);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Reject invalid limits before optional imports or SDK registration. */
function integer(value: number, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${label} must be ${minimum}..${maximum} milliseconds or items.`);
	}
	return value;
}
