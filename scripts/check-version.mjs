#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), 'utf8');
}

function readJson(path) {
  return JSON.parse(read(path));
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, expected ${expected}`);
  }
}

const version = read('VERSION').trim();

assertEqual('package.json version', readJson('package.json').version, version);
assertEqual('Codex plugin version', readJson('.codex-plugin/plugin.json').version, version);
assertEqual('Claude plugin version', readJson('.claude-plugin/plugin.json').version, version);

for (const path of [
  'skills/nullcost-catalog/SKILL.md',
  'skills/nullcost-recommend/SKILL.md',
  'skills/nullcost-search/SKILL.md',
]) {
  const match = read(path).match(/^version:\s*(.+)$/m);
  assertEqual(`${path} version`, match?.[1]?.trim(), version);
}

if (!read('mcp/nullcost-provider-server.mjs').includes(`version: "${version}"`)) {
  throw new Error(`mcp/nullcost-provider-server.mjs does not expose version ${version}`);
}

console.log(`Version check passed: ${version}`);
