import { spawnSync } from 'node:child_process';

const requiredFiles = [
  'dist/index.js',
  'assets/plugin-icon.png',
  'config.schema.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
];

const result = spawnSync('npm', ['pack', '--dry-run'], {
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

const packOutput = `${result.stdout}\n${result.stderr}`;
const missing = requiredFiles.filter((file) => !packOutput.includes(file));

if (missing.length > 0) {
  console.error(`Missing required package files:\n${missing.map((file) => `- ${file}`).join('\n')}`);
  process.exit(1);
}

console.log('Package verification passed.');
