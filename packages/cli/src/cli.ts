#!/usr/bin/env bun
import { runVulcan } from './router.ts';

process.exit(await runVulcan({ argv: process.argv.slice(2), cwd: process.cwd() }));
