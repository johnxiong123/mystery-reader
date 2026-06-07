import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const macDir = path.join(distDir, 'mac');
const appName = 'Mystery Reader';
const appBundle = path.join(macDir, `${appName}.app`);
const contentsDir = path.join(appBundle, 'Contents');
const macOsDir = path.join(contentsDir, 'MacOS');
const resourcesDir = path.join(contentsDir, 'Resources');
const bundledAppDir = path.join(resourcesDir, 'app');
const seedDir = path.join(resourcesDir, 'seed');
const nodeDir = path.join(resourcesDir, 'node');
const dmgPath = path.join(distDir, `${appName.replace(/\s+/g, '-')}-mac-arm64.dmg`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

function copy(src, dest, options = {}) {
  if (!fs.existsSync(src)) throw new Error(`Missing required path: ${src}`);
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: true,
    ...options
  });
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

async function createSeedDatabase() {
  const sourceDb = path.join(rootDir, 'data/mystery-reader.sqlite');
  if (!fs.existsSync(sourceDb)) return;
  fs.mkdirSync(seedDir, { recursive: true });
  const targetDb = path.join(seedDir, 'mystery-reader.sqlite');
  fs.rmSync(targetDb, { force: true });
  const db = new Database(sourceDb, { readonly: true });
  try {
    await db.backup(targetDb);
  } finally {
    db.close();
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('DMG packaging must run on macOS.');
  }
  if (process.arch !== 'arm64') {
    throw new Error(`This script currently packages the current arm64 runtime only. Current arch: ${process.arch}`);
  }

  run('npm', ['run', 'build', '-w', 'web']);

  fs.rmSync(macDir, { recursive: true, force: true });
  fs.rmSync(dmgPath, { force: true });
  fs.mkdirSync(macOsDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(bundledAppDir, { recursive: true });

  copy(path.join(rootDir, 'server/src'), path.join(bundledAppDir, 'server/src'));
  copy(path.join(rootDir, 'server/package.json'), path.join(bundledAppDir, 'server/package.json'));
  copy(path.join(rootDir, 'web/dist'), path.join(bundledAppDir, 'web/dist'));
  copy(path.join(rootDir, 'node_modules'), path.join(bundledAppDir, 'node_modules'), {
    filter: (src) => !src.includes(`${path.sep}.cache${path.sep}`)
  });
  copy(process.execPath, path.join(nodeDir, 'bin/node'));
  await createSeedDatabase();

  fs.writeFileSync(
    path.join(contentsDir, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleExecutable</key>
  <string>mystery-reader</string>
  <key>CFBundleIdentifier</key>
  <string>local.mystery-reader.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
`
  );

  writeExecutable(
    path.join(macOsDir, 'mystery-reader'),
    `#!/bin/bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="$APP_ROOT/Resources"
APP_DATA="$HOME/Library/Application Support/Mystery Reader"
DB_PATH="$APP_DATA/mystery-reader.sqlite"
SEED_DB="$RESOURCES/seed/mystery-reader.sqlite"

mkdir -p "$APP_DATA"
if [ ! -f "$DB_PATH" ] && [ -f "$SEED_DB" ]; then
  cp "$SEED_DB" "$DB_PATH"
fi

export MYSTERY_READER_DATA_DIR="$APP_DATA"
export OPEN_BROWSER="\${OPEN_BROWSER:-1}"
export PORT="\${PORT:-8787}"

cd "$RESOURCES/app"
exec "$RESOURCES/node/bin/node" "$RESOURCES/app/server/src/index.js"
`
  );

  run('hdiutil', [
    'create',
    '-volname',
    appName,
    '-srcfolder',
    appBundle,
    '-ov',
    '-format',
    'UDZO',
    dmgPath
  ]);

  console.log(`Created ${dmgPath}`);
}

main();
