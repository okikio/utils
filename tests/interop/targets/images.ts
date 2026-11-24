/**
 * Every container image the suite starts, pinned by digest so a run is repeatable. Renovate proposes updates; a new
 * version that changes behavior then fails the suite in its own pull request.
 *
 * Docker Hub limits anonymous pulls. Set `INTEROP_MIRROR` to a Docker Hub mirror, such as `mirror.gcr.io`, to pull its
 * images from there instead; the digest still pins each one.
 *
 * @module
 */
import process from 'node:process';

const pins = {
	postgres14: 'postgres:14.25-alpine@sha256:e7d9e6aac7fe3232f7661da103aebc0ce38b04105b46af5e9edd5ef6bc343f20',
	postgres15: 'postgres:15.20-alpine@sha256:e18480a22d6e48f4d816a6696769b1ec09ac73a824c5649e49c7d8b684913f3d',
	postgres16: 'postgres:16.16-alpine@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d',
	postgres17: 'postgres:17.9-alpine@sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609',
	postgres18: 'postgres:18.7-alpine@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71',
	postgres19: 'postgres:19.0-alpine@sha256:cac45fb483caee3668946088a1c0532db89d5285c28dbfeac889b4068296e06f',
	pgbouncer: 'edoburu/pgbouncer:v1.26.1-p0@sha256:488422e38cff912895d0d65d8963fcd306e6ac589a724398b6eb8e294e94d624',
	supabase: 'supabase/postgres:17.6.1.178@sha256:c282d393ae56fd165b7ada2ddbac55e582a601b86f3840aa2bbc112e43d3a570',
	supavisor: 'supabase/supavisor:2.10.1@sha256:b3bc49a23daa3556084a03bda62cb211cd5f62250f70f0295be12930a65073b6',
	neonProxy:
		'ghcr.io/timowilhelm/local-neon-http-proxy:main@sha256:cd2ae14edf2feafbc3330492de5c80506f77274c3bd013154cdef697bdeb768a',
	cockroach: 'cockroachdb/cockroach:v26.4.1@sha256:13331054ac7b815bcf7d4396e3416d3ef53522be308b5c4a8155079f35fe58a1',
	yugabyte:
		'yugabytedb/yugabyte:2025.2.9.0-b87@sha256:b62a0ed0d5b065c4f0b8764b1f3c3b496980d98aac46940e559ae9d5ddcb0243',
	timescale:
		'timescale/timescaledb:2.32.1-pg18@sha256:70e6526ad8e31e3f4833f2c5863b50b92d7a6bee4d432ad1f660e2c6dd956d94',
	citus: 'citusdata/citus:14.2.0-alpine@sha256:703d5b9f830dc38e265c0135223f0e12a5dc82cb2b0899b47ae37290cdacfce0',
	paradedb: 'paradedb/paradedb:0.27.0-pg18@sha256:37607fa963841e46b8a2461faf4fe3535dce9bb8019bc2dde7f207729d571ca3',
	alloydb: 'google/alloydbomni:17.10.0@sha256:ee3a5ed22fe0d239db05c990b2e0bdee6af9a40e6b7f3566fc2be4c1d4947a3e',
} as const;

/** A Docker Hub reference, such as `postgres:18` or `citusdata/citus:14`, read through `mirror`. */
export function mirrored(reference: string, mirror: string | undefined): string {
	const first = reference.split('/')[0]!;
	if (!mirror || (reference.includes('/') && /[.:]/u.test(first))) return reference;
	return `${mirror}/${reference.includes('/') ? '' : 'library/'}${reference}`;
}

const mirror = process.env.INTEROP_MIRROR?.replace(/\/+$/u, '') || undefined;

export const images: { readonly [K in keyof typeof pins]: string } = Object.freeze(
	Object.fromEntries(Object.entries(pins).map(([key, reference]) => [key, mirrored(reference, mirror)])) as {
		[K in keyof typeof pins]: string;
	},
);
