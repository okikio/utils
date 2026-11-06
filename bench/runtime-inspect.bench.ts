/** Host evidence and actual bound listener lifetimes; no operation-success inference from metadata. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
import { inspect } from '@okikio/runtime/inspect';
import { reserve } from '@okikio/runtime/deno/port';
if (inspect().host !== 'deno') throw new Error('Runtime benchmark requires its actual Deno host.');
{
	using reservation = reserve();
	if (reservation.address.port < 1 || reservation.closed) throw new Error('Reservation oracle failed.');
}
group('host diagnostics without acquisition', () => {
	bench('frozen package coverage and Web API evidence', () => do_not_optimize(inspect()));
	bench('direct identity reference, smaller contract', () => do_not_optimize(Deno.version.deno));
});
group('ephemeral port bind and release', () => {
	bench('owned reservation', () => {
		using reservation = reserve();
		do_not_optimize(reservation.address.port);
	});
	bench('native listener with equivalent bind/close', () => {
		const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
		try {
			do_not_optimize(listener.addr.port);
		} finally {
			listener.close();
		}
	});
});
await run();
