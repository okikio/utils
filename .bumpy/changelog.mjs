/**
 * Changelog formatter for the Okikio utility workspace.
 *
 * Leaf packages keep focused release histories. The @okikio/utils umbrella
 * aggregates the user-facing summaries that caused its dependency-driven bump,
 * so one-install consumers do not have to inspect dozens of leaf changelogs.
 */

const LEVEL = Object.freeze({ patch: 0, minor: 1, major: 2, none: -1 });

function typeFor(release) {
  return release?.type === 'major' || release?.type === 'minor' ? release.type : 'patch';
}

function cleanSummary(summary) {
  return String(summary ?? '')
    .replace(/^\s*(?:pr|pull|pull\s+request):\s*#?\d+\s*$/gim, '')
    .replace(/^\s*commit:\s*\S+\s*$/gim, '')
    .replace(/^\s*(?:author|user):\s*@?\S+\s*$/gim, '')
    .trim();
}

function prNumber(summary) {
  const match = String(summary ?? '').match(/^\s*(?:pr|pull|pull\s+request):\s*#?(\d+)\s*$/im);
  return match ? Number(match[1]) : null;
}

function packageRelease(bumpFile, name) {
  return bumpFile.releases.find((entry) => entry.name === name) ?? null;
}

function suppressed(bumpFile, release) {
  return bumpFile.noChangelog === true || release?.noChangelog === true;
}

function maxType(releases) {
  let chosen = 'patch';
  for (const release of releases) {
    const candidate = typeFor(release);
    if (LEVEL[candidate] > LEVEL[chosen]) chosen = candidate;
  }
  return chosen;
}

function metadataPrefix(summary, target) {
  const number = prNumber(summary);
  if (!number || target !== 'github-release') return '';
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  return repo ? `[#${number}](${server}/${repo}/pull/${number}) ` : `#${number} `;
}

function summaryLines(text, indent = '  ') {
  const lines = text.split('\n');
  if (lines.length === 1) return [lines[0]];
  return [lines[0], ...lines.slice(1).map((line) => (line ? `${indent}${line}` : ''))];
}

function directEntries(ctx) {
  const ids = new Set(ctx.release.bumpFiles ?? []);
  const entries = [];
  for (const bumpFile of ctx.bumpFiles) {
    if (!ids.has(bumpFile.id)) continue;
    const release = packageRelease(bumpFile, ctx.release.name);
    if (!release || suppressed(bumpFile, release)) continue;
    const summary = cleanSummary(bumpFile.summary);
    if (!summary) continue;
    entries.push({ bumpFile, releases: [release], summary });
  }
  return entries;
}

function umbrellaEntries(ctx, umbrella) {
  const directIds = new Set(ctx.release.bumpFiles ?? []);
  const entries = [];

  for (const bumpFile of ctx.bumpFiles) {
    const matching = bumpFile.releases.filter((release) => {
      if (release.name === umbrella) return directIds.has(bumpFile.id) && !suppressed(bumpFile, release);
      // Every focused package cascades releases into the umbrella. Use the consumed
      // bump files as the aggregate source of truth instead of release.bumpSources:
      // Bumpy intentionally short-circuits equal-severity cascade applications, so
      // bumpSources may contain only the first package that established the level.
      return release.type !== 'none' && !suppressed(bumpFile, release);
    });
    if (matching.length === 0) continue;
    const summary = cleanSummary(bumpFile.summary);
    if (!summary) continue;
    entries.push({ bumpFile, releases: matching, summary });
  }

  return entries;
}

function packageLabel(releases) {
  const names = [...new Set(releases.map((release) => release.name).filter((name) => name !== '@okikio/utils'))].sort();
  if (names.length === 0) return '';
  if (names.length > 5) return `**${names.length} utility packages** — `;
  return `${names.map((name) => `\`${name}\``).join(', ')} — `;
}

function dependencyLine(release) {
  const sources = release.bumpSources ?? [];
  if (sources.length === 0) return null;
  if (sources.length > 5) return `Updated ${sources.length} internal utility dependencies.`;
  return `Updated ${sources.map((source) => `\`${source.name}\` v${source.newVersion}`).join(', ')}.`;
}

/** Create the configured Bumpy changelog formatter. */
export default function createFormatter(options = {}) {
  const umbrella = options.umbrella ?? '@okikio/utils';

  return (ctx) => {
    const entries = ctx.release.name === umbrella ? umbrellaEntries(ctx, umbrella) : directEntries(ctx);
    const lines = [`## ${ctx.release.newVersion}`, `<sub>${ctx.date}</sub>`, ''];

    for (const entry of entries) {
      const type = maxType(entry.releases);
      const prefix = metadataPrefix(entry.bumpFile.summary, ctx.target);
      const label = ctx.release.name === umbrella ? packageLabel(entry.releases) : '';
      const rendered = summaryLines(entry.summary);
      lines.push(`- *(${type})* ${prefix}${label}${rendered[0]}`.trimEnd());
      for (const line of rendered.slice(1)) lines.push(`  ${line}`.trimEnd());
    }

    if (entries.length === 0) {
      const dependency = dependencyLine(ctx.release);
      if (dependency) lines.push(`- *(${typeFor(ctx.release)})* ${dependency}`);
    }

    if (ctx.release.name === umbrella) {
      lines.push('');
      lines.push(`Install the complete suite with \`deno add jsr:${umbrella}@${ctx.release.newVersion}\`.`);
    }

    lines.push('');
    return lines.join('\n');
  };
}
