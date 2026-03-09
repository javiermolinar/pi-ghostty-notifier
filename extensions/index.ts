import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CUSTOM_TYPE = "pi-ghostty-notifier";
const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const PROJECT_SETTINGS_PATH = join(process.cwd(), ".pi", "settings.json");

const ACTIONABLE_CATEGORIES = new Set<NotificationCategory>(["question", "error", "warning"]);

const CATEGORY_TITLES: Record<NotificationCategory, string> = {
	question: "Needs input",
	error: "Error",
	warning: "Warning",
	changes: "Changes made",
	success: "Done",
	info: "Update",
};

const CATEGORY_EMOJI: Record<NotificationCategory, string> = {
	question: "❓",
	error: "❌",
	warning: "⚠️",
	changes: "🛠️",
	success: "✅",
	info: "ℹ️",
};

type NotificationLevel = "low" | "medium" | "all";
type NotificationCategory = "question" | "error" | "warning" | "changes" | "success" | "info";
type BellPolicy = "never" | "actionable" | "always";

interface NotifierConfig {
	level: NotificationLevel;
	includeSummary: boolean;
	bell: BellPolicy;
}

interface PersistedState {
	version: 1;
	config: Partial<NotifierConfig>;
}

const defaultConfig: NotifierConfig = {
	level: "medium",
	includeSummary: true,
	bell: "actionable",
};

function readJsonFile(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		return value as Record<string, unknown>;
	} catch (error) {
		console.warn(`[${CUSTOM_TYPE}] Failed to read settings from ${path}: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

function parseSettingsConfig(settingsPath: string): Partial<NotifierConfig> {
	const settings = readJsonFile(settingsPath);
	const section = settings?.[CUSTOM_TYPE];
	if (!section || typeof section !== "object" || Array.isArray(section)) return {};
	const raw = section as Record<string, unknown>;
	const parsed: Partial<NotifierConfig> = {};
	if (raw.level === "low" || raw.level === "medium" || raw.level === "all") parsed.level = raw.level;
	if (typeof raw.includeSummary === "boolean") parsed.includeSummary = raw.includeSummary;
	if (raw.bell === "never" || raw.bell === "actionable" || raw.bell === "always") parsed.bell = raw.bell;
	return parsed;
}

function loadConfigFromSettings(): NotifierConfig {
	return {
		...defaultConfig,
		...parseSettingsConfig(GLOBAL_SETTINGS_PATH),
		...parseSettingsConfig(PROJECT_SETTINGS_PATH),
	};
}

function sanitizeOscText(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/;/g, ":").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 140): string {
	if (value.length <= max) return value;
	return value.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

function appleScriptLiteral(value: string): string {
	return JSON.stringify(value);
}

export function windowsToastScript(title: string, body: string): string {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText02`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${title.replace(/'/g, "''")}')) > $null`,
		`$xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode('${body.replace(/'/g, "''")}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${title.replace(/'/g, "''")}').Show(${toast})`,
	].join("; ");
}

function isGhostty(): boolean {
	return process.env.TERM_PROGRAM === "ghostty" || process.env.TERM?.includes("ghostty") === true || Boolean(process.env.GHOSTTY_RESOURCES_DIR);
}

function writeTerminalSequence(data: string): void {
	try {
		appendFileSync("/dev/tty", data);
		return;
	} catch {}
	if (process.stdout.isTTY) process.stdout.write(data);
}

function emitBell(): void {
	writeTerminalSequence("\u0007");
}

function emitOSC777(title: string, body: string): void {
	const safeTitle = sanitizeOscText(title);
	const safeBody = sanitizeOscText(body);
	writeTerminalSequence(`\u001b]777;notify;${safeTitle};${safeBody}\u001b\\`);
}

function emitOSC99(title: string, body: string): void {
	const safeTitle = sanitizeOscText(title);
	const safeBody = sanitizeOscText(body);
	writeTerminalSequence(`\u001b]99;i=1:d=0;${safeTitle}\u001b\\`);
	writeTerminalSequence(`\u001b]99;i=1:p=body;${safeBody}\u001b\\`);
}

function levelAllows(level: NotificationLevel, category: NotificationCategory): boolean {
	if (level === "all") return true;
	if (level === "low") return category === "question" || category === "error";
	return category === "question" || category === "error" || category === "warning" || category === "changes";
}

function shouldBell(policy: BellPolicy, category: NotificationCategory): boolean {
	if (policy === "never") return false;
	if (policy === "always") return true;
	return ACTIONABLE_CATEGORIES.has(category);
}

function pickFirstMeaningfulLine(text: string): string {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/^[-*]\s+/, "").replace(/^#+\s+/, ""));
	return lines[0] ?? "";
}

function firstSentence(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	const match = normalized.match(/.+?[.!?](?=\s|$)/);
	return match?.[0]?.trim() ?? normalized;
}

function extractAssistantText(message: any): string {
	if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content
		.filter((block: any) => block?.type === "text" && typeof block.text === "string")
		.map((block: any) => block.text)
		.join("\n")
		.trim();
}

export function extractFinalTurnToolResults(messages: any[]): any[] {
	let lastAssistantIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "assistant") {
			lastAssistantIndex = index;
			break;
		}
	}
	if (lastAssistantIndex <= 0) return [];

	const toolResults: any[] = [];
	for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "toolResult") {
			toolResults.unshift(message);
			continue;
		}
		break;
	}
	return toolResults;
}

function assistantSignalsFailure(text: string): boolean {
	return /\b(i (couldn't|could not|can't|cannot|wasn't able to)|unable to|failed to|couldn't complete|could not complete|did not complete)\b/i.test(text);
}

function inferCategory(text: string, toolResults: any[]): NotificationCategory {
	const hasToolError = toolResults.some((message) => message?.role === "toolResult" && message.isError === true);
	const hasToolSuccess = toolResults.some((message) => message?.role === "toolResult" && message.isError !== true);
	const lastToolResult = toolResults.at(-1);
	const hasSuccessfulChange = toolResults.some(
		(message) => message?.role === "toolResult" && message.isError !== true && (message.toolName === "edit" || message.toolName === "write"),
	);

	if (assistantSignalsFailure(text)) return "error";
	if (hasToolError && (!hasToolSuccess || lastToolResult?.isError === true)) return "error";
	if (/\?\s*$/.test(text) || /(would you like|do you want|should i|want me to|how would you like)/i.test(text)) return "question";

	const firstLine = pickFirstMeaningfulLine(text) || text.trim();
	if (/^(warning|caveat|be aware)\b/i.test(firstLine)) return "warning";
	if (/\b(partial|couldn't|could not|unable to)\b/i.test(firstLine)) return "warning";

	if (hasSuccessfulChange) return "changes";
	if (hasToolError) return "warning";
	if (/(done|completed|implemented|updated|created|fixed|added|wrote|reviewed)/i.test(text)) return "success";
	return "info";
}

function fallbackSummary(category: NotificationCategory, toolResults: any[], assistantText: string): string {
	if (category === "error") {
		const failed = toolResults.find((message) => message?.role === "toolResult" && message.isError === true);
		if (failed?.toolName) return `${failed.toolName} failed`;
		if (assistantSignalsFailure(assistantText)) return "Pi couldn't complete the request";
		return "A tool call failed";
	}
	if (category === "changes") return "Pi made changes and is ready for input";
	if (category === "warning") return "Pi finished with caveats";
	if (category === "question") return "Pi is waiting for your input";
	if (category === "success") return "Pi finished successfully";
	return "Pi is ready for input";
}

export function summarizeAssistantTurn(message: any, toolResults: any[], includeSummary: boolean): { category: NotificationCategory; body: string } {
	const assistantText = extractAssistantText(message);
	const category = inferCategory(assistantText, toolResults);
	if (!includeSummary) return { category, body: fallbackSummary(category, toolResults, assistantText) };
	const summarySource = firstSentence(pickFirstMeaningfulLine(assistantText) || assistantText);
	const body = truncate(summarySource || fallbackSummary(category, toolResults, assistantText), 160);
	return { category, body };
}

export function summarizeTurn(messages: any[], includeSummary: boolean): { category: NotificationCategory; body: string } {
	const lastAssistant = [...messages].reverse().find((message) => message?.role === "assistant");
	const toolResults = extractFinalTurnToolResults(messages);
	return summarizeAssistantTurn(lastAssistant, toolResults, includeSummary);
}

function renderCategoryTitle(category: NotificationCategory): string {
	return `${CATEGORY_EMOJI[category]} Pi · ${CATEGORY_TITLES[category]}`;
}

function extractPersistedConfig(state: PersistedState | undefined): Partial<Pick<NotifierConfig, "level">> {
	const level = state?.config?.level;
	if (level === "low" || level === "medium" || level === "all") return { level };
	return {};
}

export function mergeConfig(settingsConfig: NotifierConfig, state: PersistedState | undefined): NotifierConfig {
	return {
		...settingsConfig,
		...extractPersistedConfig(state),
	};
}

export default function ghosttyNotifierExtension(pi: ExtensionAPI) {
	let config: NotifierConfig = loadConfigFromSettings();

	function getState(): PersistedState {
		return {
			version: 1,
			config: {
				level: config.level,
			},
		};
	}

	function persistState(): void {
		pi.appendEntry(CUSTOM_TYPE, { state: getState() });
	}

	function reconstructState(ctx: ExtensionContext): void {
		const settingsConfig = loadConfigFromSettings();
		let lastState: PersistedState | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
			const state = (entry.data as { state?: PersistedState } | undefined)?.state;
			if (state?.version === 1) lastState = state;
		}
		config = mergeConfig(settingsConfig, lastState);
	}

	async function sendNativeMacNotification(title: string, body: string): Promise<void> {
		const script = `display notification ${appleScriptLiteral(body)} with title ${appleScriptLiteral(title)}`;
		await pi.exec("osascript", ["-e", script], { timeout: 5000 });
	}

	async function sendWindowsNotification(title: string, body: string): Promise<void> {
		await pi.exec("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)], { timeout: 5000 });
	}

	async function notify(title: string, body: string, category: NotificationCategory): Promise<void> {
		const wantsBell = shouldBell(config.bell, category);

		try {
			if (wantsBell) emitBell();
			if (isGhostty()) emitOSC777(title, body);
			else if (process.env.KITTY_WINDOW_ID) emitOSC99(title, body);
			else emitOSC777(title, body);

			if (process.platform === "darwin") await sendNativeMacNotification(title, body);
			else if (process.env.WT_SESSION) await sendWindowsNotification(title, body);
		} catch (error) {
			console.warn(`[${CUSTOM_TYPE}] Notification failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	function notifyCommandResult(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info"): void {
		ctx.ui.notify(message, level);
	}

	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_switch", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_fork", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	pi.on("turn_end", async (event, ctx) => {
		if (!ctx.hasUI) return;
		const message = (event as any).message;
		if (!message || message.role !== "assistant") return;
		const toolResults = Array.isArray((event as any).toolResults) ? ((event as any).toolResults as any[]) : [];
		const { category, body } = summarizeAssistantTurn(message, toolResults, config.includeSummary);
		if (!levelAllows(config.level, category)) return;
		await notify(renderCategoryTitle(category), body, category);
	});

	pi.registerCommand("notify-level", {
		description: "Show or set notification level: low, medium, all",
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) {
				notifyCommandResult(ctx, `Notification level: ${config.level}`);
				return;
			}
			if (value !== "low" && value !== "medium" && value !== "all") {
				notifyCommandResult(ctx, "Usage: /notify-level [low|medium|all]", "warning");
				return;
			}
			config = { ...config, level: value };
			persistState();
			notifyCommandResult(ctx, `Notification level set to ${value}`);
		},
	});
}
