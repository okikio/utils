/** Own a private application network, a certificate authority and an actual nginx TLS edge. @module */
import '@okikio/dispose/polyfill';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { start } from './container.ts';

/** Reuse the exact nginx owner already selected for the repository's streaming integration tests. */
export const Image = 'nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236';
/** Fixture commands have explicit deadlines and operate only on their per-run resources. */
const command = promisify(execFile);

/** A new CA is scoped to this fixture and is never installed in the user's trust store. */
async function certificates(directory: string): Promise<void> {
	const configuration = `[req]
prompt = no
distinguished_name = subject
[subject]
CN = Utils isolated transport test
[ca]
basicConstraints = critical,CA:true
keyUsage = critical,keyCertSign,cRLSign
[server]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1
`;
	await writeFile(resolve(directory, 'openssl.cnf'), configuration);
	// Separate request configurations keep issuer and leaf names distinct on
	// both LibreSSL and OpenSSL, including when prompt=no supplies the subject.
	await writeFile(
		resolve(directory, 'root.cnf'),
		configuration.replace('CN = Utils isolated transport test', 'CN = Utils isolated root CA'),
	);
	/** Keep certificate subprocesses bounded and their output out of normal test receipts. */
	const run = async (args: string[]) => {
		await command('openssl', args, { cwd: directory, timeout: 15000, maxBuffer: 65536 });
	};
	await run([
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-sha256',
		'-days',
		'2',
		'-config',
		'root.cnf',
		'-extensions',
		'ca',
		'-keyout',
		'ca.key',
		'-out',
		'ca.pem',
	]);
	await run([
		'req',
		'-new',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-config',
		'openssl.cnf',
		'-keyout',
		'server.key',
		'-out',
		'server.csr',
	]);
	await run([
		'x509',
		'-req',
		'-in',
		'server.csr',
		'-CA',
		'ca.pem',
		'-CAkey',
		'ca.key',
		'-CAcreateserial',
		'-days',
		'2',
		'-sha256',
		'-extfile',
		'openssl.cnf',
		'-extensions',
		'server',
		'-out',
		'server.pem',
	]);
}

/** Start the edge after its origin; disposal closes the edge, joins origin cleanup, then removes network and keys. */
export async function open() {
	await using setup = new AsyncDisposableStack();
	const base = resolve('.tmp/tests/duplex/proxy');
	await mkdir(base, { recursive: true });
	const directory = await mkdtemp(resolve(base, 'run-'));
	setup.defer(async () => await rm(directory, { recursive: true, force: true }));
	await certificates(directory);
	// Testcontainers' Network owner always provisions a reaper. These two
	// explicitly joined containers instead own one named, labeled Docker network.
	const network = `utils-duplex-proxy-${crypto.randomUUID()}`;
	await command('docker', ['network', 'create', '--label', 'okikio.owner=utils-duplex-proxy-tests', network], {
		timeout: 15000,
	});
	setup.defer(async () => {
		await command('docker', ['network', 'rm', network], { timeout: 15000 });
	});
	const host = setup.use(await start({ network }));
	// The normal route forwards incrementally. Deliberately broken routes prove
	// why buffering and idle-read limits are deployment contracts, not library defaults.
	const configuration = `pid /tmp/nginx.pid;
error_log /dev/stderr info;
events {}
http {
 access_log /dev/stdout;
 error_log /dev/stderr info;
 gzip off;
 proxy_http_version 1.1;
 proxy_set_header Connection "";
 proxy_buffering off;
 proxy_request_buffering off;
 proxy_ignore_client_abort off;
 proxy_next_upstream off;
 proxy_read_timeout 15s;
 client_body_temp_path /tmp/client-body;
 proxy_temp_path /tmp/proxy;
 fastcgi_temp_path /tmp/fastcgi;
 uwsgi_temp_path /tmp/uwsgi;
 scgi_temp_path /tmp/scgi;
 server {
  listen 8443 ssl;
  ssl_certificate /fixture/server.pem;
  ssl_certificate_key /fixture/server.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  location = /ready { return 200 'ready'; }
  location = /attempt { proxy_pass http://duplex:8080/attempt; }
  location = /buffered { proxy_buffering on; proxy_pass http://duplex:8080/attempt; }
  location = /idle { proxy_read_timeout 1s; proxy_pass http://duplex:8080/attempt; }
  absolute_redirect off;
  location = /redirect { return 307 /attempt; }
  location / { return 404; }
 }
}
`;
	await writeFile(resolve(directory, 'nginx.conf'), configuration);
	let log = '';
	const name = `utils-duplex-proxy-${crypto.randomUUID()}`;
	let started: StartedTestContainer | undefined;
	// Register before startup: Testcontainers can reject before returning a
	// handle, leaving a failed container attached to the owned network.
	setup.defer(async () => {
		if (started) await started.stop({ timeout: 2000 });
		else {
			const remaining = await command('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], { timeout: 15000 });
			if (remaining.stdout.trim()) await command('docker', ['rm', '-f', name], { timeout: 15000 });
		}
	});
	// The default policy reuses cached images and pulls this pinned revision when absent.
	const proxy = started = await new GenericContainer(process.env.UTILS_DUPLEX_PROXY_IMAGE ?? Image)
		.withName(name)
		.withLabels({ 'okikio.owner': 'utils-duplex-proxy-tests' })
		.withNetworkMode(network).withAutoCleanup(false).withAutoRemove(true)
		.withUser('101:101')
		.withEntrypoint(['nginx']).withCommand(['-g', 'daemon off;', '-c', '/fixture/nginx.conf'])
		// The unprivileged edge receives only its leaf key, never the signing CA key.
		.withCopyFilesToContainer(['nginx.conf', 'server.pem', 'server.key'].map((name) => ({
			source: resolve(directory, name),
			target: `/fixture/${name}`,
			mode: 0o644,
		})))
		.withResourcesQuota({ memory: 0.125, cpu: 1 })
		.withDroppedCapabilities('ALL').withSecurityOpt('no-new-privileges')
		.withExposedPorts(8443).withWaitStrategy(Wait.forListeningPorts()).withStartupTimeout(30000)
		.withLogConsumer((stream) =>
			stream.on('data', (chunk) => {
				log = (log + String(chunk)).slice(-32768);
			})
		)
		.start().catch((cause: unknown) => {
			throw new Error(`TLS proxy startup failed: ${log}`, { cause });
		});
	const owners = setup.move();
	return {
		host,
		origin: `https://127.0.0.1:${proxy.getMappedPort(8443)}`,
		ca: resolve(directory, 'ca.pem'),
		configuration,
		async diagnostics() {
			return { image: process.env.UTILS_DUPLEX_PROXY_IMAGE ?? Image, version: await proxy.exec(['nginx', '-v']), log };
		},
		async certificate() {
			return await readFile(resolve(directory, 'server.pem'), 'utf8');
		},
		async [Symbol.asyncDispose]() {
			await owners.disposeAsync();
		},
	};
}
