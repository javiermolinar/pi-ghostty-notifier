#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "pi-ghostty-notifier";
const EXTENSION_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", PACKAGE_NAME);
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILES_TO_COPY = ["package.json", "README.md", "extensions/index.ts"];

const args = process.argv.slice(2);
const isRemove = args.includes("--remove") || args.includes("-r");
const isHelp = args.includes("--help") || args.includes("-h");

function printHelp() {
	console.log(`\n${PACKAGE_NAME}\n\nUsage:\n  npx ${PACKAGE_NAME}          Install or update the extension\n  npx ${PACKAGE_NAME} --remove Remove the installed extension\n  npx ${PACKAGE_NAME} --help   Show this help\n`);
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function copyInstall() {
	ensureDir(EXTENSION_DIR);
	for (const file of FILES_TO_COPY) {
		const source = path.join(SOURCE_DIR, file);
		const target = path.join(EXTENSION_DIR, file);
		ensureDir(path.dirname(target));
		fs.copyFileSync(source, target);
	}
}

if (isHelp) {
	printHelp();
	process.exit(0);
}

if (isRemove) {
	if (fs.existsSync(EXTENSION_DIR)) {
		fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });
		console.log(`Removed ${EXTENSION_DIR}`);
	} else {
		console.log("Extension is not installed");
	}
	process.exit(0);
}

copyInstall();
console.log(`Installed to ${EXTENSION_DIR}`);
console.log("Run /reload in pi if it is already running.");
