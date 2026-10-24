import fs from "node:fs/promises";
import { globalShortcut } from "electron";
import { type ShortcutBinding } from "../src/lib/shortcuts";
import { SHORTCUTS_FILE } from "./ipc/handlers";

/** Shortcuts registered OS-wide (work while the app is in the background). */
export type GlobalShortcutAction = "openApp" | "summonHud";

const DEFAULT_GLOBAL_BINDINGS: Record<GlobalShortcutAction, ShortcutBinding> = {
	openApp: { key: "o", ctrl: true, shift: true },
	summonHud: { key: "h", alt: true },
};

// Maps KeyboardEvent.key values to Electron accelerator key names
const KEY_TO_ACCELERATOR: Record<string, string> = {
	" ": "Space",
	"+": "Plus",
	"-": "numsub",
	"*": "nummult",
	"/": "numdiv",
	arrowup: "Up",
	arrowdown: "Down",
	arrowleft: "Left",
	arrowright: "Right",
	escape: "Escape",
	enter: "Return",
	backspace: "Backspace",
	delete: "Delete",
	tab: "Tab",
};

function bindingToAccelerator(binding: ShortcutBinding): string {
	const parts: string[] = [];
	if (binding.ctrl) parts.push("CommandOrControl");
	if (binding.shift) parts.push("Shift");
	if (binding.alt) parts.push("Alt");

	const keyLower = binding.key.toLowerCase();
	const acceleratorKey = KEY_TO_ACCELERATOR[keyLower] ?? binding.key.toUpperCase();
	parts.push(acceleratorKey);

	return parts.join("+");
}

const currentAccelerators = new Map<GlobalShortcutAction, string>();

export function registerGlobalActionShortcut(
	action: GlobalShortcutAction,
	binding: ShortcutBinding,
	onTrigger: () => void,
): boolean {
	const accelerator = bindingToAccelerator(binding);
	const existing = currentAccelerators.get(action);

	if (accelerator === existing) {
		return true;
	}

	// Register the new shortcut before unregistering the old, so a failure leaves the old binding intact
	const success = globalShortcut.register(accelerator, onTrigger);

	if (success) {
		if (existing) {
			globalShortcut.unregister(existing);
		}
		currentAccelerators.set(action, accelerator);
		console.log(`Global shortcut registered (${action}): ${accelerator}`);
	} else {
		console.warn(`Failed to register global shortcut (${action}): ${accelerator}`);
	}

	return success;
}

export async function loadAndRegisterGlobalShortcuts(
	handlers: Record<GlobalShortcutAction, () => void>,
): Promise<void> {
	let saved: Partial<Record<GlobalShortcutAction, ShortcutBinding>> = {};
	try {
		saved = JSON.parse(await fs.readFile(SHORTCUTS_FILE, "utf-8"));
	} catch {
		// No saved shortcuts yet; fall back to defaults below.
	}
	for (const action of Object.keys(DEFAULT_GLOBAL_BINDINGS) as GlobalShortcutAction[]) {
		registerGlobalActionShortcut(
			action,
			saved[action] ?? DEFAULT_GLOBAL_BINDINGS[action],
			handlers[action],
		);
	}
}

export function unregisterAllGlobalShortcuts(): void {
	globalShortcut.unregisterAll();
}
