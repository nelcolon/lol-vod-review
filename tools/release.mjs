// Tags the current commit v<apps/desktop version> and pushes the tag; GitHub Actions
// (.github/workflows/release.yml) then builds the installer and publishes the release.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'));
const tag = `v${version}`;

if (sh('git status --porcelain')) fail('commit or stash your changes first');
if (sh('git rev-parse --abbrev-ref HEAD') !== 'main') fail('releases are cut from main');
sh('git fetch -q origin main --tags');
if (sh('git rev-parse HEAD') !== sh('git rev-parse origin/main')) fail('push main first (local and origin/main differ)');
if (sh(`git tag -l ${tag}`)) fail(`${tag} already exists; bump "version" in apps/desktop/package.json`);

// The release workflow no longer tests; CI (.github/workflows/ci.yml) must have passed on this commit.
const head = sh('git rev-parse HEAD');
let ci;
try {
  ci = JSON.parse(sh(`gh run list -w ci.yml --commit ${head} -L 1 --json status,conclusion,url`))[0];
} catch (e) {
  fail(`could not ask GitHub for the CI result (is gh signed in?): ${e.message}`);
}
if (!ci) fail(`no CI run for ${head.slice(0, 7)} yet; wait a few seconds after pushing`);
if (ci.status !== 'completed') fail(`CI is still running for ${head.slice(0, 7)}: ${ci.url}`);
if (ci.conclusion !== 'success') fail(`CI ${ci.conclusion} for ${head.slice(0, 7)}: ${ci.url}`);

sh(`git tag -a ${tag} -m "LoL VOD Review ${version}"`);
sh(`git push -q origin ${tag}`);
console.log(`Pushed ${tag}. GitHub Actions is building it: https://github.com/nelcolon/lol-vod-review/actions`);
