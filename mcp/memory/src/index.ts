#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryServer } from "./tools.js";

const server = await createMemoryServer();
const transport = new StdioServerTransport();
await server.connect(transport);