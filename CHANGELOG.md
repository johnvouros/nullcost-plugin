# Changelog

## Unreleased

- Add `nullcost-plugin` CLI for low-token installs into Codex, Claude Desktop, Cursor, Windsurf, and generic MCP clients.
- Add installer doctor checks for MCP startup, advertised tools, and optional live catalog smoke tests.

## 0.1.1

- Fix free-entry recommendation output so enterprise, overage, or paid-plan prices do not appear as the headline price for providers with a real free tier or trial.
- Add structured `rawStartingPrice` and `freeEntry` fields so hosts can preserve the catalog signal without treating raw pricing text as the user-facing starter price.

## 0.1.0

- Initial public version of the Nullcost site, catalog API, local MCP server, and plugin packaging.
- Focuses on free-tier and free-trial developer tool discovery.
- Uses a hosted or local Supabase catalog as the source of truth.
