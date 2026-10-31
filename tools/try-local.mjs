// Builds the installer on this PC and installs it over the installed app, to try changes before
// a release (no GitHub, no upload). Run on Windows from the repo root:
//
//   npm run try            typecheck, tests, smoke test, build, install, start
//   npm run try -- --quick skip typecheck/tests/smoke
//   npm run try -- --force install even while League is running (stops a recording!)
//
// The build is versioned <next>-local.<time> (e.g. 0.3.10-local.1031.0452), so Settings shows it
// is a test build and the next official release (0.3.10) still updates over it.
import { execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps', 'desktop');
const releaseDir = join(desktop, 'release');
const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'LoL VOD Review', 'LoL VOD Review.exe');
const args = new Set(process.argv.slice(2));
const quick = args.has('--quick');
const force = args.has('--force');

const fail = (msg) => {
  console.error(`\ntry: ${msg}`);
  process.exit(1);
};
const step = (msg) => console.log(`\n== ${msg}`);
const run = (cmd, cwd = root, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const out = (cmd) => {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const running = (image) => out(`tasklist /FI "IMAGENAME eq ${image}" /NH`).toLowerCase().includes(image.toLowerCase());

if (process.platform !== 'win32') fail('run this on Windows (from WSL: cmd.exe /c "cd /d <repo> && npm run try")');
if (running('League of Legends.exe') && !force) fail('League is running: installing now would stop the recording. Try again after the game (or pass --force).');

// version: the package version, or the next patch when that one is already released
const { version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
let base = version;
if (out(`git tag -l v${version}`)) {
  const [maj, min, pat] = version.split('-')[0].split('.').map(Number);
  base = `${maj}.${min}.${pat + 1}`;
}
const d = new Date();
const two = (n) => String(n).padStart(2, '0');
const localVersion = `${base}-local.${two(d.getMonth() + 1)}${two(d.getDate())}.${two(d.getHours())}${two(d.getMinutes())}`;
console.log(`Local test build ${localVersion} (installed copy will be replaced)`);

const t0 = Date.now();
step('build packages');
run('npm run build -w packages/schema -w packages/core');
if (!quick) {
  step('typecheck');
  run('npm run typecheck');
  step('tests');
  run('npm test');
}
step('recorder (cargo build --release)');
run('cargo build --release --manifest-path packages/recorder/Cargo.toml');

step('close the installed app');
// one instance only: the smoke test and the installer both need it gone
if (running('LoL VOD Review.exe')) {
  out('taskkill /IM "LoL VOD Review.exe"');
  for (let i = 0; i < 20 && running('LoL VOD Review.exe'); i++) execSync('ping -n 2 127.0.0.1 >nul');
  if (running('LoL VOD Review.exe')) out('taskkill /F /T /IM "LoL VOD Review.exe"');
}
out('taskkill /F /IM lvr-recorder.exe');

if (!quick) {
  step('smoke test (mock library, real app)');
  try {
    run('npm run smoke -w apps/desktop');
  } catch {
    if (existsSync(exe)) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    fail('smoke test failed; nothing was installed (your app was restarted as it was)');
  }
}

step('installer');
for (const f of existsSync(releaseDir) ? readdirSync(releaseDir) : []) if (f.includes('-local.')) rmSync(join(releaseDir, f), { force: true });
run(`npx electron-vite build && npx electron-builder --win --config electron-builder.yml --publish never -c.extraMetadata.version=${localVersion}`, desktop);
const setup = join(releaseDir, `LoL-VOD-Review-Setup-${localVersion}.exe`);
if (!existsSync(setup)) fail(`installer not found: ${setup}`);

step('install (silent, same folder as before)');
execSync(`"${setup}" /S`, { stdio: 'inherit' });
if (!existsSync(exe)) fail(`installed app not found at ${exe}`);
spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();

console.log(`\nInstalled and started ${localVersion} in ${Math.round((Date.now() - t0) / 1000)} s.`);
console.log('The next official release replaces it through the usual update window.');
