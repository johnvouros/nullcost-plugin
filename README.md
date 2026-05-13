<p align="center">
  <a href="https://nullcost.xyz">
    <img src="docs/assets/nullcost-github-logo.svg" alt="Nullcost logo" width="112" height="112">
  </a>
</p>

<h1 align="center">Nullcost Plugin</h1>

<p align="center">
  Give your coding agent a catalog-backed shortcut for finding developer tools with real free tiers and trials.
</p>

<p align="center">
  <a href="https://nullcost.xyz"><strong>Open Nullcost</strong></a>
  ·
  <a href="https://nullcost.xyz/install"><strong>Install guide</strong></a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-25ce69?style=for-the-badge">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-232f3e?style=for-the-badge">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-server-7c3aed?style=for-the-badge">
  <img alt="Catalog" src="https://img.shields.io/badge/catalog-hosted-111827?style=for-the-badge">
</p>

<p align="center">
  <a href="https://nullcost.xyz">
    <img src="docs/assets/nullcost-readme-banner.png" alt="Nullcost catalog-backed free-tier developer tool discovery banner">
  </a>
</p>

## What This Is

This repo contains only the public installable Nullcost pieces:

- Codex plugin metadata
- Claude/plugin metadata
- Nullcost skills
- Local stdio MCP server
- Icons and install docs

It does not include the hosted Nullcost website, production database, referral router internals, admin dashboard, or private provider catalog data.

## Why Install It

Ask normal questions like:

```text
What is a cheap auth service with a real free tier?
```

Nullcost routes that to the hosted catalog and returns a compact DB-backed shortlist. For v1, it intentionally does not browse live pricing pages after a catalog result unless you explicitly ask for live web verification.

## Fast Install

In Codex or another plugin-aware coding app, ask:

```text
Install the Nullcost Catalog plugin from https://github.com/johnvouros/nullcost-plugin. Use it when I ask about cheap or free-tier developer tools. If plugin install is not supported here, configure the Nullcost MCP server instead.
```

## Raw MCP Config

If your client supports stdio MCP but not plugins, clone this repo and point the client at:

```json
{
  "mcpServers": {
    "nullcost": {
      "command": "node",
      "args": ["/path/to/nullcost-plugin/scripts/run-provider-server.mjs"],
      "env": {
        "NULLCOST_API_BASE_URL": "https://nullcost.xyz"
      }
    }
  }
}
```

Replace `/path/to/nullcost-plugin` with your local clone path.

## Local Test

```bash
npm install
npm run version:check
npm run mcp:catalog
```

The MCP server defaults to the hosted Nullcost API at `https://nullcost.xyz`, so you do not need to run the website locally.

## What It Exposes

| Tool | Purpose |
| --- | --- |
| `search_providers` | Search developer services by category or keyword. |
| `recommend_providers` | Rank providers for one use case. |
| `recommend_stack` | Shortlist a small app stack, such as hosting + auth + Postgres + email. |
| `get_provider_detail` | Fetch catalog details for one provider. |

## Boundary

This repo is Apache-2.0 licensed. The hosted Nullcost website, hosted database contents, production credentials, referral routing data, and user data are not part of this repo or license grant.

## License

Apache-2.0. See [LICENSE](LICENSE).
