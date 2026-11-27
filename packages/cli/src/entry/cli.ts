#!/usr/bin/env bun
import { runVulcan } from './router.ts';

const exitCode = await runVulcan({ argv: process.argv.slice(2), cwd: process.cwd() });

process.exit(exitCode);
