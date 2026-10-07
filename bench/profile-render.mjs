import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { profileReceipt } from './profile-startup.mjs';
const folder = process.argv[2];
const escape = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
for (const name of await readdir(folder)) {
	if (!name.endsWith('.cpuprofile')) continue;
	const profile = JSON.parse(await readFile(`${folder}/${name}`, 'utf8'));
	profileReceipt(profile);
	const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
	const parents = new Map();
	for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
	const tree = { name: 'all sampled stacks', url: '', self: 0, total: 0, children: new Map() };
	const self = new Map(), inclusive = new Map();
	let maxDepth = 0;
	let negativeDeltas = 0, negativeDeltaUs = 0;
	for (let index = 0; index < profile.samples.length; index++) {
		const id = profile.samples[index], raw = profile.timeDeltas[index] ?? 0;
		if (raw < 0) {
			negativeDeltas++;
			negativeDeltaUs += raw;
		}
		const weight = Math.max(0, raw);
		self.set(id, (self.get(id) ?? 0) + weight);
		const stack = [];
		let current = id;
		const visited = new Set();
		while (current !== undefined) {
			if (visited.has(current)) throw new Error('Cycle in profile tree.');
			visited.add(current);
			const node = nodes.get(current);
			if (!node) throw new Error(`Unknown profile node ${current}`);
			stack.unshift(node);
			inclusive.set(current, (inclusive.get(current) ?? 0) + weight);
			current = parents.get(current);
		}
		let branch = tree;
		branch.total += weight;
		for (const node of stack) {
			const frame = node.callFrame,
				key = `${frame.functionName}:${frame.url}:${frame.lineNumber}:${frame.columnNumber}`;
			let child = branch.children.get(key);
			if (!child) {
				child = {
					name: frame.functionName || '(anonymous)',
					url: frame.url,
					line: frame.lineNumber,
					self: 0,
					total: 0,
					children: new Map(),
				};
				branch.children.set(key, child);
			}
			child.total += weight;
			branch = child;
		}
		branch.self += weight;
		maxDepth = Math.max(maxDepth, stack.length);
	}
	const rows = profile.nodes.map((node) => ({
		function: node.callFrame.functionName || '(anonymous)',
		url: node.callFrame.url,
		line: node.callFrame.lineNumber + 1,
		selfUs: self.get(node.id) ?? 0,
		inclusiveUs: inclusive.get(node.id) ?? 0,
	})).filter((row) => row.selfUs || row.inclusiveUs);
	rows.sort((a, b) => b.selfUs - a.selfUs);
	await writeFile(
		`${folder}/${name}.summary.json`,
		JSON.stringify(
			{
				negativeDeltas,
				negativeDeltaUs,
				displayRule: 'Negative sample deltas are zero-width for display; raw profiles retained unchanged.',
				samples: profile.samples.length,
				profileDurationUs: profile.endTime - profile.startTime,
				sampledUs: tree.total,
				functions: rows,
			},
			null,
			2,
		),
	);
	const width = 1440, height = (maxDepth + 1) * 20 + 100;
	const fragments = [];
	const draw = (branch, x, y, w) => {
		const percent = (branch.total / tree.total * 100).toFixed(2);
		const color = branch.name === '(garbage collector)'
			? '#d884b3'
			: branch.url.includes('/packages/server/gateway/')
			? '#f5a35c'
			: branch.url.includes('/packages/server/service/')
			? '#ffd270'
			: branch.url.includes('node_modules')
			? '#8dc7e8'
			: branch.url.includes('ext:')
			? '#95cc9c'
			: '#e7bc8f';
		fragments.push(
			`<g class="frame" onclick="zoom(this)" data-x="${x}" data-w="${w}"><title>${
				escape(branch.name)
			} | ${percent}% inclusive | ${(branch.self / 1000).toFixed(3)} ms self | ${escape(branch.url)}:${
				(branch.line ?? -1) + 1
			}</title><rect x="${x}" y="${y}" width="${
				Math.max(0, w - .5)
			}" height="19" fill="${color}" stroke="#fff" stroke-width=".4"/><text x="${x + 3}" y="${y + 14}" font-size="11">${
				escape(branch.name.slice(0, Math.max(0, Math.floor((w - 5) / 7))))
			}</text></g>`,
		);
		let cursor = x;
		for (const child of branch.children.values()) {
			const childWidth = w * child.total / branch.total;
			draw(child, cursor, y - 20, childWidth);
			cursor += childWidth;
		}
	};
	draw(tree, 10, height - 35, width - 20);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text{font-family:monospace;pointer-events:none}.frame{cursor:pointer}#reset{cursor:pointer;fill:#135a85}</style><rect width="100%" height="100%" fill="#fafafa"/><text x="12" y="24" font-size="18">${
			escape(basename(name))
		} — sampled stacks</text><text x="12" y="46" font-size="12">${profile.samples.length} samples; ${
			(tree.total / 1e6).toFixed(3)
		} sampled seconds. Width includes children; hover for self time. Click to zoom.</text><text id="reset" x="12" y="68" onclick="reset()">Reset zoom</text><g id="stacks">${
			fragments.join('')
		}</g><script><![CDATA[function zoom(node){let x=Number(node.dataset.x),w=Number(node.dataset.w);document.getElementById('stacks').setAttribute('transform','translate('+(10-x*(1420/w))+',0) scale('+(1420/w)+',1)')}function reset(){document.getElementById('stacks').removeAttribute('transform')}]]></script></svg>`;
	await writeFile(`${folder}/${name}.svg`, svg);
	console.log(
		name,
		profile.samples.length,
		'samples',
		rows.slice(0, 12).map((row) => `${row.function}:${(row.selfUs / tree.total * 100).toFixed(1)}%`).join(', '),
	);
}
