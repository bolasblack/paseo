#!/usr/bin/env npx tsx

import assert from "node:assert";
import { $ } from "zx";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

$.verbose = false;

console.log("=== Agent Resume Command Tests ===\n");

const port = 10000 + Math.floor(Math.random() * 50000);
const paseoHome = await mkdtemp(join(tmpdir(), "paseo-test-home-"));

try {
  {
    console.log("Test 1: agent resume --help shows options");
    const result = await $`npx paseo agent resume --help`.nothrow();
    assert.strictEqual(result.exitCode, 0, "agent resume --help should exit 0");
    assert(result.stdout.includes("--host"), "help should mention --host option");
    assert(result.stdout.includes("<id>"), "help should mention required id argument");
    console.log("✓ agent resume --help shows options\n");
  }

  {
    console.log("Test 2: top-level resume --help shows options");
    const result = await $`npx paseo resume --help`.nothrow();
    assert.strictEqual(result.exitCode, 0, "resume --help should exit 0");
    assert(result.stdout.includes("--host"), "help should mention --host option");
    assert(result.stdout.includes("<id>"), "help should mention required id argument");
    console.log("✓ top-level resume --help shows options\n");
  }

  {
    console.log("Test 3: agent resume requires ID argument");
    const result =
      await $`PASEO_HOST=localhost:${port} PASEO_HOME=${paseoHome} npx paseo agent resume`.nothrow();
    assert.notStrictEqual(result.exitCode, 0, "should fail without id");
    const output = result.stdout + result.stderr;
    const hasError =
      output.toLowerCase().includes("missing") ||
      output.toLowerCase().includes("required") ||
      output.toLowerCase().includes("argument");
    assert(hasError, "error should mention missing argument");
    console.log("✓ agent resume requires ID argument\n");
  }

  {
    console.log("Test 4: agent resume handles daemon not running");
    const result =
      await $`PASEO_HOST=localhost:${port} PASEO_HOME=${paseoHome} npx paseo agent resume abc123`.nothrow();
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    const output = result.stdout + result.stderr;
    const hasError =
      output.toLowerCase().includes("daemon") ||
      output.toLowerCase().includes("connect") ||
      output.toLowerCase().includes("cannot");
    assert(hasError, "error message should mention connection issue");
    console.log("✓ agent resume handles daemon not running\n");
  }

  {
    console.log("Test 5: agent --help shows resume subcommand");
    const result = await $`npx paseo agent --help`.nothrow();
    assert.strictEqual(result.exitCode, 0, "agent --help should exit 0");
    assert(result.stdout.includes("resume"), "help should mention resume subcommand");
    console.log("✓ agent --help shows resume subcommand\n");
  }
} finally {
  await rm(paseoHome, { recursive: true, force: true });
}

console.log("=== All agent resume tests passed ===");
