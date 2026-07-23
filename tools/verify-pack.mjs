import { spawnSync } from 'node:child_process';

const requiredFiles = [
  'dist/index.js',
  'assets/plugin-icon.png',
  'config.schema.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
];

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  env: {
    ...process.env,
    npm_config_cache: '.npm-cache',
  },
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const packs = JSON.parse(result.stdout);
if (packs.error) {
  console.error(packs.error.summary ?? 'npm pack failed.');
  process.exit(1);
}
const files = new Set(packs[0]?.files?.map((file) => file.path.replace(/^package\//, '')));
const missing = requiredFiles.filter((file) => !files.has(file));

if (missing.length > 0) {
  console.error(`Missing required package files:\n${missing.map((file) => `- ${file}`).join('\n')}`);
  process.exit(1);
}

console.log('Package verification passed.');
