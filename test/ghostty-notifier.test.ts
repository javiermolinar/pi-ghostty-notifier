import test from "node:test";
import assert from "node:assert/strict";

import ghosttyNotifierExtension, { extractFinalTurnToolResults, mergeConfig, summarizeTurn, windowsToastScript } from "../extensions/index.ts";

test("extractFinalTurnToolResults only returns tool results for the final assistant message", () => {
	const messages = [
		{ role: "assistant", content: [{ type: "text", text: "Trying first approach" }] },
		{ role: "toolResult", toolName: "read", isError: true },
		{ role: "assistant", content: [{ type: "text", text: "Applying the fix" }] },
		{ role: "toolResult", toolName: "write", isError: false },
		{ role: "toolResult", toolName: "edit", isError: false },
		{ role: "assistant", content: [{ type: "text", text: "Done." }] },
	];

	assert.deepEqual(extractFinalTurnToolResults(messages), [
		{ role: "toolResult", toolName: "write", isError: false },
		{ role: "toolResult", toolName: "edit", isError: false },
	]);
});

test("summarizeTurn ignores earlier tool failures once the final turn succeeds", () => {
	const messages = [
		{ role: "assistant", content: [{ type: "text", text: "Trying a fallback." }] },
		{ role: "toolResult", toolName: "read", isError: true },
		{ role: "assistant", content: [{ type: "text", text: "Applying the final changes." }] },
		{ role: "toolResult", toolName: "write", isError: false },
		{ role: "assistant", content: [{ type: "text", text: "Done. Updated the notifier logic." }] },
	];

	assert.deepEqual(summarizeTurn(messages, true), {
		category: "changes",
		body: "Done.",
	});
});

test("summarizeTurn still reports an error when the final turn has a failed tool result", () => {
	const messages = [
		{ role: "assistant", content: [{ type: "text", text: "Inspecting the file." }] },
		{ role: "toolResult", toolName: "read", isError: true },
		{ role: "assistant", content: [{ type: "text", text: "I couldn't complete that change." }] },
	];

	assert.deepEqual(summarizeTurn(messages, false), {
		category: "error",
		body: "read failed",
	});
});

test("mergeConfig keeps persisted level overrides without freezing other settings-file values", () => {
	const settingsConfig = {
		level: "medium",
		includeSummary: false,
		bell: "always",
	} as const;
	const persistedState = {
		version: 1 as const,
		config: {
			level: "low",
			includeSummary: true,
			bell: "never",
		},
	};

	assert.deepEqual(mergeConfig(settingsConfig, persistedState), {
		level: "low",
		includeSummary: false,
		bell: "always",
	});
});

test("windowsToastScript places the title in the first text slot and the body in the second", () => {
	const script = windowsToastScript("Notifier title", "Notifier body");

	const titleIndex = script.indexOf("GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('Notifier title'))");
	const bodyIndex = script.indexOf("GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode('Notifier body'))");

	assert.notEqual(titleIndex, -1);
	assert.notEqual(bodyIndex, -1);
	assert.ok(titleIndex < bodyIndex);
});

test("agent_end skips notifications in non-interactive contexts", async () => {
	const handlers = new Map<string, Function>();
	let execCalls = 0;

	ghosttyNotifierExtension({
		on(event: string, handler: Function) {
			handlers.set(event, handler);
		},
		registerCommand() {},
		appendEntry() {},
		exec: async () => {
			execCalls += 1;
			return { stdout: "", stderr: "", code: 0, killed: false };
		},
	} as any);

	const agentEnd = handlers.get("agent_end");
	assert.ok(agentEnd);

	await agentEnd(
		{
			messages: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }],
		},
		{
			hasUI: false,
		},
	);

	assert.equal(execCalls, 0);
});
