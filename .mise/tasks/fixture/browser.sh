#!/usr/bin/env bash
#MISE description="Install selected browser revisions from the pinned Playwright package"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
# With --with-deps, Playwright installs Ubuntu packages through apt. In GitHub Actions the downloaded
# .deb files are kept beside the browser cache, so a slow Ubuntu mirror cannot stall the job. apt
# still checks every cached file against the signed package index before it installs it.
debs=''
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then debs="${UTILS_PLAYWRIGHT_DEBS:-$HOME/.cache/ms-playwright-apt}"; fi
if [[ -z "$debs" || " $* " != *' --with-deps '* ]]; then
	exec node node_modules/playwright/cli.js install "$@"
fi
if compgen -G "$debs/*.deb" >/dev/null; then
	echo "Reusing $(find "$debs" -name '*.deb' | wc -l) cached Ubuntu packages."
	sudo cp "$debs"/*.deb /var/cache/apt/archives/
fi
node node_modules/playwright/cli.js install "$@"
mkdir -p "$debs"
if compgen -G '/var/cache/apt/archives/*.deb' >/dev/null; then cp /var/cache/apt/archives/*.deb "$debs"/; fi
