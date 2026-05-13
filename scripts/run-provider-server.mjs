#!/usr/bin/env node

process.env.NULLCOST_API_BASE_URL ||= 'https://nullcost.xyz';

await import('../mcp/nullcost-provider-server.mjs');
