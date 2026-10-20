#!/usr/bin/env node
/**
 * Lanza Jest con `--experimental-vm-modules`.
 * NestJS 12 se publica como ESM puro; Jest 30 solo puede hacer `require()` de
 * módulos ESM (como hace Node 24 de forma nativa) cuando vm.SourceTextModule está habilitado.
 */
const { spawnSync } = require('node:child_process');

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(
  process.execPath,
  ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning', jestBin, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
