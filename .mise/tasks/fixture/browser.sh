#!/usr/bin/env bash
#MISE description="Install selected browser revisions from the pinned Playwright package"
#MISE hide=true
#MISE depends=[]
set -euo pipefail
# With --with-deps, Playwright refreshes apt's package index and downloads Ubuntu packages. Hosted
# runners sometimes reach a slow Ubuntu mirror, so in GitHub Actions the downloaded .deb files are
# kept beside the browser cache (only trusted refs save it). On the next run apt installs those files
# without refreshing its index and without downgrading anything already installed; it downloads only
# a dependency the cache lacks. If that fails, for example after a runner image change, the normal
# --with-deps path runs and refreshes the cache.
debs=''
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then debs="${UTILS_PLAYWRIGHT_DEBS:-$HOME/.cache/ms-playwright-apt}"; fi
if [[ -z "$debs" || " $* " != *' --with-deps '* ]]; then
	exec node node_modules/playwright/cli.js install "$@"
fi
browsers=()
for argument in "$@"; do [[ "$argument" == --with-deps ]] || browsers+=("$argument"); done
if compgen -G "$debs/*.deb" >/dev/null &&
	sudo apt-get install --yes --no-install-recommends "$debs"/*.deb; then
	echo "Installed Playwright's Ubuntu packages from $(find "$debs" -name '*.deb' | wc -l) cached files."
	exec node node_modules/playwright/cli.js install "${browsers[@]}"
fi
node node_modules/playwright/cli.js install "$@"
rm -rf "$debs"
mkdir -p "$debs"
if compgen -G '/var/cache/apt/archives/*.deb' >/dev/null; then cp /var/cache/apt/archives/*.deb "$debs"/; fi
