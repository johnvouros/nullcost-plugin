#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readText(join(packageRoot, 'package.json')));
const DEFAULT_BASE_URL = 'https://nullcost.xyz';
const DEFAULT_MARKETPLACE = 'nullcost-local';
const PLUGIN_NAME = 'nullcost-catalog';
const MCP_SERVER_NAME = 'nullcost';
const EXPECTED_TOOLS = [
  'search_providers',
  'recommend_providers',
  'recommend_stack',
  'get_provider_detail',
];

async function main() {
  const { command, positional, options } = parseCommand(process.argv.slice(2));

  if (!command && options.version) {
    console.log(packageJson.version);
    return;
  }

  if (!command || command === 'help' || options.help) {
    printHelp();
    return;
  }

  if (command === '--version' || command === 'version') {
    console.log(packageJson.version);
    return;
  }

  if (command === 'mcp-server') {
    process.env.NULLCOST_API_BASE_URL ||= DEFAULT_BASE_URL;
    await import('../scripts/run-provider-server.mjs');
    return;
  }

  if (command === 'install') {
    await installCommand(positional, options);
    return;
  }

  if (command === 'doctor') {
    await doctorCommand(options);
    return;
  }

  if (command === 'config') {
    await configCommand(positional, options);
    return;
  }

  throw new Error(`Unknown command "${command}". Run "nullcost-plugin help".`);
}

function parseCommand(argv) {
  const positional = [];
  const options = {};
  const valueOptions = new Set([
    'base-url',
    'codex-home',
    'config',
    'dir',
    'install-root',
    'plugin-dir',
  ]);

  let command = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!command && !arg.startsWith('-')) {
      command = arg;
      continue;
    }

    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const raw = arg.slice(2);
      const [name, inlineValue] = raw.split('=', 2);

      if (valueOptions.has(name)) {
        const value = inlineValue ?? argv[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error(`Missing value for --${name}`);
        }
        options[name] = value;
        if (inlineValue === undefined) {
          index += 1;
        }
      } else {
        options[name] = inlineValue ?? true;
      }
      continue;
    }

    positional.push(arg);
  }

  return { command, positional, options };
}

async function installCommand(positional, options) {
  const target = normalizeTarget(positional[0] || 'codex');
  const baseUrl = options['base-url'] || DEFAULT_BASE_URL;
  const paths = getInstallPaths(options);

  console.log(`Nullcost ${packageJson.version} installer`);
  console.log(`Target: ${target}`);
  console.log(`Install root: ${paths.installRoot}`);

  await installPackageFiles(paths, options);
  await ensureDependencies(paths.pluginDir, options);
  const serverConfig = makeServerConfig(paths.pluginDir, baseUrl);

  if (target === 'codex') {
    await configureCodex(paths, serverConfig, options);
  } else if (target === 'mcp') {
    await configureGenericMcp(target, serverConfig, options);
  } else {
    await configureGenericMcp(target, serverConfig, options);
  }

  if (!options['skip-doctor'] && !options['dry-run']) {
    await runDoctor({
      pluginDir: paths.pluginDir,
      baseUrl,
      quick: Boolean(options.quick || options['no-catalog']),
      verbose: Boolean(options.verbose),
    });
  }

  console.log('');
  console.log(options['dry-run'] ? 'Dry run complete.' : 'Install complete.');
  if (!options['dry-run']) {
    console.log(restartHint(target));
  }
}

async function doctorCommand(options) {
  const baseUrl = options['base-url'] || DEFAULT_BASE_URL;
  const pluginDir = getDoctorPluginDir(options);

  await runDoctor({
    pluginDir,
    baseUrl,
    quick: Boolean(options.quick || options['no-catalog']),
    verbose: Boolean(options.verbose),
  });
}

async function configCommand(positional, options) {
  const target = normalizeTarget(positional[0] || 'mcp');
  const baseUrl = options['base-url'] || DEFAULT_BASE_URL;
  const paths = getInstallPaths(options);
  const serverConfig = makeServerConfig(paths.pluginDir, baseUrl);

  if (target === 'codex') {
    console.log(makeCodexTomlSnippet(paths, serverConfig));
    return;
  }

  console.log(JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: serverConfig } }, null, 2));
}

function normalizeTarget(value) {
  const normalized = String(value || '').toLowerCase();
  const aliases = {
    'claude-desktop': 'claude',
    'generic': 'mcp',
    'other': 'mcp',
  };
  const target = aliases[normalized] || normalized;
  const supported = new Set(['codex', 'claude', 'cursor', 'windsurf', 'mcp']);

  if (!supported.has(target)) {
    throw new Error(`Unsupported install target "${value}". Supported targets: codex, claude, cursor, windsurf, mcp.`);
  }

  return target;
}

function getInstallPaths(options) {
  const installRoot = resolvePath(options['install-root'] || options.dir || join(homedir(), '.nullcost'));
  const pluginDir = join(installRoot, 'plugins', PLUGIN_NAME);

  return { installRoot, pluginDir };
}

function getDoctorPluginDir(options) {
  if (options['plugin-dir']) {
    return resolvePath(options['plugin-dir']);
  }

  return getInstallPaths(options).pluginDir;
}

async function installPackageFiles(paths, options) {
  await mkdir(dirname(paths.pluginDir), { recursive: true });

  if (samePath(packageRoot, paths.pluginDir)) {
    console.log('Plugin files: using current checkout');
    return;
  }

  if (isInside(paths.pluginDir, packageRoot)) {
    throw new Error('Refusing to copy the package into its own source tree. Choose an install root outside the repo.');
  }

  if (options['dry-run']) {
    console.log(`Would copy plugin files to ${paths.pluginDir}`);
    return;
  }

  await cp(packageRoot, paths.pluginDir, {
    recursive: true,
    force: true,
    filter(source) {
      const rel = relative(packageRoot, source);
      if (!rel) {
        return true;
      }
      const first = rel.split(sep)[0];
      return !new Set(['.git', 'node_modules', '.env']).has(first) && !rel.endsWith('.log');
    },
  });

  console.log(`Plugin files: ${paths.pluginDir}`);
}

async function ensureDependencies(pluginDir, options) {
  const sdkPath = join(pluginDir, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
  const zodPath = join(pluginDir, 'node_modules', 'zod', 'package.json');

  if (existsSync(sdkPath) && existsSync(zodPath)) {
    console.log('Dependencies: already installed');
    return;
  }

  if (options['skip-deps']) {
    console.log('Dependencies: skipped');
    return;
  }

  if (options['dry-run']) {
    console.log(`Would run npm install --omit=dev --ignore-scripts in ${pluginDir}`);
    return;
  }

  console.log('Dependencies: installing');
  const npm = platform() === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--omit=dev', '--ignore-scripts'], {
    cwd: pluginDir,
    encoding: 'utf8',
    stdio: options.verbose ? 'inherit' : 'pipe',
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`npm install failed in ${pluginDir}${output ? `\n${output}` : ''}`);
  }

  console.log('Dependencies: installed');
}

async function configureCodex(paths, serverConfig, options) {
  await ensureCodexMarketplace(paths, options);

  const codexHome = resolvePath(options['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'));
  const configPath = join(codexHome, 'config.toml');
  const current = await readOptionalText(configPath);
  const updated = upsertCodexConfig(current, paths, serverConfig);

  await writeChanged(configPath, updated, options);
  console.log(`Codex config: ${configPath}`);
}

async function ensureCodexMarketplace(paths, options) {
  const marketplacePath = join(paths.installRoot, '.agents', 'plugins', 'marketplace.json');
  const existing = await readOptionalJson(marketplacePath, {
    name: DEFAULT_MARKETPLACE,
    interface: {
      displayName: 'Nullcost Local',
    },
    plugins: [],
  });

  existing.name ||= DEFAULT_MARKETPLACE;
  existing.interface ||= {};
  existing.interface.displayName ||= 'Nullcost Local';
  existing.plugins = Array.isArray(existing.plugins) ? existing.plugins : [];

  const entry = {
    name: PLUGIN_NAME,
    source: {
      source: 'local',
      path: `./plugins/${PLUGIN_NAME}`,
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: 'Coding',
  };

  const index = existing.plugins.findIndex((plugin) => plugin?.name === PLUGIN_NAME);
  if (index >= 0) {
    existing.plugins[index] = entry;
  } else {
    existing.plugins.push(entry);
  }

  await writeChanged(marketplacePath, `${JSON.stringify(existing, null, 2)}\n`, options);
  console.log(`Codex marketplace: ${marketplacePath}`);
}

function upsertCodexConfig(current, paths, serverConfig) {
  let text = current.trimEnd();
  const sections = makeCodexSections(paths, serverConfig);

  for (const [header, body] of sections) {
    text = upsertTomlSection(text, header, body);
  }

  return `${text.trimEnd()}\n`;
}

function makeCodexSections(paths, serverConfig) {
  return [
    [
      `[plugins."${PLUGIN_NAME}@${DEFAULT_MARKETPLACE}"]`,
      ['enabled = true'],
    ],
    [
      `[marketplaces.${DEFAULT_MARKETPLACE}]`,
      [
        `last_updated = ${tomlString(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'))}`,
        'source_type = "local"',
        `source = ${tomlString(paths.installRoot)}`,
      ],
    ],
    [
      `[mcp_servers.${MCP_SERVER_NAME}]`,
      [
        `command = ${tomlString(serverConfig.command)}`,
        `args = [${serverConfig.args.map(tomlString).join(', ')}]`,
      ],
    ],
    [
      `[mcp_servers.${MCP_SERVER_NAME}.env]`,
      Object.entries(serverConfig.env || {}).map(([key, value]) => `${key} = ${tomlString(value)}`),
    ],
  ];
}

function makeCodexTomlSnippet(paths, serverConfig) {
  return makeCodexSections(paths, serverConfig)
    .map(([header, body]) => [header, ...body].join('\n'))
    .join('\n\n');
}

function upsertTomlSection(text, header, bodyLines) {
  const lines = text ? text.split('\n') : [];
  const start = lines.findIndex((line) => line.trim() === header);
  const replacement = [header, ...bodyLines, ''];

  if (start === -1) {
    const prefix = lines.length ? [...lines, ''] : [];
    return [...prefix, ...replacement].join('\n');
  }

  let end = start + 1;
  while (end < lines.length && !/^\s*\[.+\]\s*$/.test(lines[end])) {
    end += 1;
  }

  lines.splice(start, end - start, ...replacement);
  return lines.join('\n');
}

async function configureGenericMcp(target, serverConfig, options) {
  const configPath = options.config ? resolvePath(options.config) : defaultMcpConfigPath(target);

  if (!configPath) {
    console.log('MCP config: no default config path for this target.');
    console.log('Add this JSON to your MCP client config:');
    console.log(JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: serverConfig } }, null, 2));
    console.log('');
    console.log('Or rerun with --config /absolute/path/to/mcp.json');
    return;
  }

  const existing = await readOptionalJson(configPath, {});
  existing.mcpServers ||= {};
  existing.mcpServers[MCP_SERVER_NAME] = serverConfig;

  await writeChanged(configPath, `${JSON.stringify(existing, null, 2)}\n`, options);
  const label = target === 'mcp' ? 'MCP config' : `${displayTarget(target)} MCP config`;
  console.log(`${label}: ${configPath}`);
}

function defaultMcpConfigPath(target) {
  if (target === 'mcp') {
    return null;
  }

  if (target === 'cursor') {
    return join(homedir(), '.cursor', 'mcp.json');
  }

  if (target === 'windsurf') {
    if (platform() === 'win32') {
      return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Codeium', 'Windsurf', 'mcp_config.json');
    }
    return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
  }

  if (target === 'claude') {
    if (platform() === 'darwin') {
      return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    }
    if (platform() === 'win32') {
      return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    }
    return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  }

  return null;
}

function makeServerConfig(pluginDir, baseUrl) {
  return {
    command: 'node',
    args: [join(pluginDir, 'scripts', 'run-provider-server.mjs')],
    env: {
      NULLCOST_API_BASE_URL: baseUrl,
    },
  };
}

async function runDoctor({ pluginDir, baseUrl, quick, verbose }) {
  console.log('');
  console.log('Running doctor');
  const serverScript = join(pluginDir, 'scripts', 'run-provider-server.mjs');
  const sdkPath = join(pluginDir, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');

  await assertExists(pluginDir, 'plugin directory');
  await assertExists(serverScript, 'MCP server script');
  await assertExists(join(pluginDir, '.codex-plugin', 'plugin.json'), 'Codex plugin manifest');
  await assertExists(join(pluginDir, '.mcp.json'), 'MCP metadata');
  await assertNodeVersion();
  await assertExists(sdkPath, 'MCP SDK dependency');

  const tools = await listMcpTools(serverScript, baseUrl, verbose);
  for (const tool of EXPECTED_TOOLS) {
    if (!tools.includes(tool)) {
      throw new Error(`MCP tool "${tool}" was not advertised. Got: ${tools.join(', ')}`);
    }
  }

  console.log(`MCP tools: ${tools.join(', ')}`);

  if (!quick) {
    await callCatalogSmoke(serverScript, baseUrl, verbose);
    console.log('Catalog smoke test: passed');
  } else {
    console.log('Catalog smoke test: skipped');
  }

  console.log('Doctor: passed');
}

async function listMcpTools(serverScript, baseUrl, verbose) {
  const client = await connectMcpClient(serverScript, baseUrl, verbose);
  try {
    const result = await withTimeout(client.listTools(), 8000, 'Timed out listing MCP tools');
    return result.tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
  }
}

async function callCatalogSmoke(serverScript, baseUrl, verbose) {
  const client = await connectMcpClient(serverScript, baseUrl, verbose);
  try {
    const result = await withTimeout(client.callTool({
      name: 'recommend_providers',
      arguments: {
        useCase: 'free tier hosting for a small Node app',
        limit: 1,
        preferFreeTier: true,
      },
    }), 25000, 'Timed out calling the Nullcost catalog');

    const text = result.content?.find((item) => item.type === 'text')?.text || '';
    if (!text.includes('Providers found') && !text.includes('Catalog unavailable')) {
      throw new Error('MCP catalog call returned an unexpected response.');
    }
  } finally {
    await client.close();
  }
}

async function connectMcpClient(serverScript, baseUrl, verbose) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
    env: {
      ...process.env,
      NULLCOST_API_BASE_URL: baseUrl,
    },
    stderr: verbose ? 'inherit' : 'pipe',
  });
  const client = new Client({ name: 'nullcost-doctor', version: packageJson.version });

  await withTimeout(client.connect(transport), 8000, 'Timed out starting Nullcost MCP server');
  return client;
}

async function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isFinite(major) || major < 18) {
    throw new Error(`Node.js 18 or newer is required. Current version: ${process.version}`);
  }
}

async function assertExists(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

async function writeChanged(path, content, options) {
  const existing = await readOptionalText(path);
  if (existing === content) {
    console.log(`Unchanged: ${path}`);
    return;
  }

  if (options['dry-run']) {
    console.log(`Would write ${path}`);
    return;
  }

  await mkdir(dirname(path), { recursive: true });

  if (existing) {
    const backup = `${path}.bak-${timestampForFile()}`;
    await copyFile(path, backup);
    console.log(`Backup: ${backup}`);
  }

  await writeFile(path, content);
  console.log(`Wrote: ${path}`);
}

async function readOptionalJson(path, fallback) {
  const text = await readOptionalText(path);
  if (!text.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse JSON in ${path}: ${error.message}`);
  }
}

async function readOptionalText(path) {
  try {
    return await readText(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function readText(path) {
  return readFile(path, 'utf8');
}

function resolvePath(path) {
  const value = String(path);
  if (value === '~') {
    return homedir();
  }
  if (value.startsWith(`~${sep}`) || value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }
  return resolve(value);
}

function samePath(left, right) {
  return resolve(left) === resolve(right);
}

function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel && !rel.startsWith('..') && !rel.startsWith(sep);
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function displayTarget(target) {
  const names = {
    claude: 'Claude Desktop',
    codex: 'Codex',
    cursor: 'Cursor',
    mcp: 'MCP client',
    windsurf: 'Windsurf',
  };
  return names[target] || target;
}

function restartHint(target) {
  if (target === 'codex') {
    return 'Next: restart Codex, then ask a cheap/free-tier developer tool question.';
  }
  return `Next: restart ${displayTarget(target)}, then ask a cheap/free-tier developer tool question.`;
}

function printHelp() {
  console.log(`Nullcost Plugin ${packageJson.version}

Usage:
  npx nullcost-plugin@latest install codex
  npx nullcost-plugin@latest install claude
  npx nullcost-plugin@latest install cursor
  npx nullcost-plugin@latest install windsurf
  npx nullcost-plugin@latest install mcp --config /path/to/mcp.json
  npx nullcost-plugin@latest doctor

Commands:
  install <target>   Install plugin files, configure the target, and run doctor.
  doctor             Verify the installed MCP server and catalog connection.
  config <target>    Print the config snippet without writing files.
  mcp-server         Run the Nullcost MCP server directly.

Targets:
  codex              Adds Codex marketplace/plugin config and MCP fallback.
  claude             Writes Claude Desktop MCP config.
  cursor             Writes Cursor MCP config.
  windsurf           Writes Windsurf MCP config.
  mcp                Writes a generic MCP JSON config when --config is set.

Options:
  --install-root DIR Install under DIR/plugins/nullcost-catalog.
  --dir DIR          Alias for --install-root.
  --plugin-dir DIR   Doctor only: check an existing plugin checkout.
  --config FILE      MCP JSON config path for generic or overridden installs.
  --codex-home DIR   Override Codex home. Defaults to CODEX_HOME or ~/.codex.
  --base-url URL     Defaults to ${DEFAULT_BASE_URL}.
  --quick            Doctor lists tools but skips the live catalog request.
  --skip-doctor      Install without running doctor.
  --skip-deps        Do not run npm install in the stable plugin directory.
  --dry-run          Print intended file writes without changing files.
`);
}

main().catch((error) => {
  console.error('');
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
