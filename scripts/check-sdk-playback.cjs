#!/usr/bin/env node
// Guard: the SDK playback executables are git-ignored build products
// (see build/sdk-playback/README.txt). Packaging without them silently ships a broken app.
//   node scripts/check-sdk-playback.cjs arm64 x64          # before electron-builder
//   node scripts/check-sdk-playback.cjs --packaged <dir>    # after: check a built .app / unpacked dir
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MACHO = { arm64: 0x0100000c, x64: 0x01000007 };

function check(file, arch) {
  if (!fs.existsSync(file)) return `missing: ${file}`;
  const st = fs.statSync(file);
  if (st.size < 1024 * 1024) return `too small (${st.size} bytes): ${file}`;
  if (!(st.mode & 0o111)) return `not executable: ${file}`;
  if (arch) {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(8);
    fs.readSync(fd, b, 0, 8, 0);
    fs.closeSync(fd);
    if (b.readUInt32LE(0) !== 0xfeedfacf || b.readUInt32LE(4) !== MACHO[arch]) {
      return `wrong architecture (expected darwin-${arch} Mach-O): ${file}`;
    }
  }
  return null;
}

const args = process.argv.slice(2);
const errors = [];
if (args[0] === '--packaged') {
  const dir = args[1];
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'hongguo-sdk-playback') found.push(p);
    }
  })(dir);
  if (!found.length) errors.push(`no hongguo-sdk-playback inside ${dir}`);
  for (const f of found) {
    const m = f.match(/darwin-(arm64|x64)/);
    const err = check(f, m && m[1]);
    if (err) errors.push(err);
  }
} else {
  for (const arch of args.length ? args : ['arm64', 'x64']) {
    const err = check(path.join(root, 'build/sdk-playback', `darwin-${arch}`, 'hongguo-sdk-playback'), arch);
    if (err) errors.push(`${err}\n  build it with: scripts/build-sdk-playback-mac.sh ${arch} (on a matching ${arch} host)`);
  }
}
if (errors.length) {
  console.error('SDK playback check FAILED:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log('SDK playback check OK');
