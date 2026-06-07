// Build a self-contained, loadable extension folder + zip.
//
// `npm run package` produces build/parago/ (load this unpacked in chrome://extensions
// on any machine, no npm needed) and build/parago-v<version>.zip (attach to a GitHub
// release). The popup/options pages load raw ES modules, so the whole src/ tree ships
// alongside the bundled dist/ content + background scripts.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = 'build/parago';

if (!existsSync('src/config.js')) {
  console.error('Missing src/config.js. Copy src/config.example.js to src/config.js and set your project ref first.');
  process.exit(1);
}

rmSync('build', { recursive: true, force: true });
mkdirSync(`${OUT}/dist`, { recursive: true });

const common = { bundle: true, format: 'iife', target: 'chrome120', logLevel: 'info' };
await build({ ...common, entryPoints: ['src/content/filter.js'], outfile: `${OUT}/dist/content.js` });
await build({ ...common, entryPoints: ['src/content/checkout.entry.js'], outfile: `${OUT}/dist/checkout.js` });
await build({ ...common, entryPoints: ['src/background.js'], outfile: `${OUT}/dist/background.js` });

// Static runtime files the manifest references (popup/options pages run raw modules).
cpSync('manifest.json', `${OUT}/manifest.json`);
cpSync('src', `${OUT}/src`, { recursive: true });

const version = JSON.parse(readFileSync('manifest.json', 'utf8')).version;
const zip = `build/parago-v${version}.zip`;
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${OUT}/*' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
} else {
  execFileSync('sh', ['-c', `cd '${OUT}' && zip -qr '../parago-v${version}.zip' .`], { stdio: 'inherit' });
}
console.log(`\nPackaged: ${zip}\nUnpacked folder: ${OUT}/ (Load unpacked in chrome://extensions)`);
