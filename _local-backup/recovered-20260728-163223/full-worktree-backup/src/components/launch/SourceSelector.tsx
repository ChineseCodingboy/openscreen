import { useCallback, useEffect, useState } from "react";
import { MdCheck } from "react-icons/md";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import styles from "./SourceSelector.module.css";

interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	/** Window found only by native enumeration (typically full-screen on another Space). */
	fromOtherSpace?: boolean;
}

/** System artifacts desktopCapturer reports as windows but that make no sense to record. */
const JUNK_WINDOW_NAMES = new Set([
	"App Icon Window",
	"Gesture Blocking Overlay",
	"Item-0",
	"Window Server",
	"Dock",
	"Notification Center",
	"Control Center",
	"Control Centre",
	"Wallpaper",
	"Spotlight",
	"Menubar",
	"StatusIndicator",
]);

function isJunkWindowSource(id: string, ...names: string[]): boolean {
	if (!id.startsWith("window:")) return false;
	const meaningful = names.map((name) => name.trim()).filter(Boolean);
	if (meaningful.length === 0) return true;
	return meaningful.some((name) => JUNK_WINDOW_NAMES.has(name));
}

function windowIdFromSourceId(id: string): string | null {
	if (!id.startsWith("window:")) return null;
	return id.split(":")[1] ?? null;
}

export function SourceSelector() {
	const t = useScopedT("launch");
	const tc = useScopedT("common");
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);

	const fetchSources = useCallback(async () => {
		setLoading(true);
		setLoadFailed(false);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 1280, height: 720 },
				fetchWindowIcons: true,
			});
			const mappedSources = rawSources
				.map((source) => ({
					id: source.id,
					name:
						source.id.startsWith("window:") && source.name.includes(" — ")
							? source.name.split(" — ")[1] || source.name
							: source.name,
					thumbnail: source.thumbnail,
					display_id: source.display_id,
					appIcon: source.appIcon,
				}))
				.filter((source) => !isJunkWindowSource(source.id, source.name));
			setSources(mappedSources);
			setSelectedSource((current) =>
				current && mappedSources.some((source) => source.id === current.id) ? current : null,
			);
			setLoading(false);

			// Second phase: windows on other Spaces (full-screen apps) are invisible to
			// desktopCapturer, so append them from the native ScreenCaptureKit list once
			// its screenshots are ready.
			const nativeResult = await window.electronAPI.listNativeWindows?.().catch((error) => {
				console.warn("listNativeWindows failed:", error);
				return null;
			});
			if (nativeResult && !nativeResult.success) {
				console.warn("listNativeWindows returned an error:", nativeResult.message);
			}
			if (nativeResult?.success && nativeResult.windows?.length) {
				const knownWindowIds = new Set(
					mappedSources
						.map((source) => windowIdFromSourceId(source.id))
						.filter((id): id is string => id !== null),
				);
				const extraSources: DesktopSource[] = nativeResult.windows
					.filter((win) => !knownWindowIds.has(String(win.windowId)))
					.filter((win) => win.appName !== "Openscreen")
					.filter((win) => !isJunkWindowSource(win.id, win.title, win.appName))
					.map((win) => ({
						id: win.id,
						name: win.title || win.name,
						thumbnail: win.thumbnail,
						display_id: "",
						appIcon: null,
						fromOtherSpace: true,
					}));
				if (extraSources.length > 0) {
					setSources((current) => {
						const currentIds = new Set(current.map((source) => source.id));
						return [...current, ...extraSources.filter((source) => !currentIds.has(source.id))];
					});
				}
			}
		} catch (error) {
			console.error("Error loading sources:", error);
			setSources([]);
			setSelectedSource(null);
			setLoadFailed(true);
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchSources();
	}, [fetchSources]);

	const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
	const windowSources = sources.filter((s) => s.id.startsWith("window:"));
	const hasNoSources = !loading && sources.length === 0;

	const handleSourceSelect = (source: DesktopSource) => setSelectedSource(source);
	const handleShare = async () => {
		if (selectedSource) await window.electronAPI.selectSource(selectedSource);
	};

	if (loading) {
		return (
			<div
				className={`h-full flex items-center justify-center ${styles.glassContainer}`}
				style={{ minHeight: "100vh" }}
			>
				<div className="text-center">
					<div className="animate-spin duration-500 rounded-[50%] h-6 w-6 border-2 border-b-transparent border-[#34B27B] mx-auto mb-2" />
					<p className="text-xs text-zinc-400">{t("sourceSelector.loading")}</p>
				</div>
			</div>
		);
	}

	if (hasNoSources) {
		return (
			<div
				className={`h-full flex items-center justify-center ${styles.glassContainer}`}
				style={{ minHeight: "100vh" }}
			>
				<div className="max-w-[320px] px-6 text-center">
					<h2 className="text-sm font-semibold text-white">{t("sourceSelector.emptyTitle")}</h2>
					<p className="mt-2 text-xs leading-5 text-zinc-400">
						{loadFailed
							? t("sourceSelector.loadFailedDescription")
							: t("sourceSelector.emptyDescription")}
					</p>
					<Button
						onClick={() => void fetchSources()}
						className="mt-4 h-8 rounded-lg bg-[#34B27B] px-5 text-[11px] font-semibold text-white transition-transform duration-150 hover:bg-[#34B27B]/85 active:scale-95"
					>
						{tc("actions.reload")}
					</Button>
				</div>
			</div>
		);
	}

	const renderSourceCard = (source: DesktopSource) => {
		const isSelected = selectedSource?.id === source.id;
		const sourceKind = source.id.startsWith("screen:") ? "screen" : "window";
		return (
			<div
				key={source.id}
				data-testid="source-selector-card"
				data-source-kind={sourceKind}
				className={`${styles.sourceCard} ${isSelected ? styles.selected : ""} p-1.5`}
				onClick={() => handleSourceSelect(source)}
			>
				<div className="relative mb-1.5 overflow-hidden rounded-lg border border-white/[0.06] bg-black/30">
					<img
						src={source.thumbnail || ""}
						alt={source.name}
						className="w-full aspect-video object-cover"
					/>
					{isSelected && (
						<div className="absolute right-1.5 top-1.5">
							<div className={styles.checkBadge}>
								<MdCheck size={11} className="text-white" />
							</div>
						</div>
					)}
					{source.fromOtherSpace && (
						<div className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white/90">
							{t("sourceSelector.otherSpace")}
						</div>
					)}
				</div>
				<div className="flex items-center gap-1.5 px-1 pb-0.5">
					{source.appIcon && (
						<img src={source.appIcon} alt="" className={`${styles.icon} flex-shrink-0`} />
					)}
					<div className={`${styles.name} truncate`}>{source.name}</div>
				</div>
			</div>
		);
	};

	return (
		<div className={`min-h-screen flex flex-col ${styles.glassContainer}`}>
			<div className="flex-1 flex flex-col w-full px-3.5 pt-3.5">
				<Tabs
					defaultValue={screenSources.length === 0 ? "windows" : "screens"}
					className="flex-1 flex flex-col"
				>
					<TabsList className="mb-3 grid h-8 grid-cols-2 rounded-xl border border-white/[0.06] bg-white/[0.04] p-0.5">
						<TabsTrigger
							value="screens"
							className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
						>
							{t("sourceSelector.screens", { count: String(screenSources.length) })}
						</TabsTrigger>
						<TabsTrigger
							value="windows"
							className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
						>
							{t("sourceSelector.windows", { count: String(windowSources.length) })}
						</TabsTrigger>
					</TabsList>
					<div className="flex-1 min-h-0">
						<TabsContent value="screens" className="h-full mt-0">
							<div
								className={`grid h-[282px] auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto pr-1.5 pt-1 ${styles.sourceGridScroll}`}
							>
								{screenSources.map(renderSourceCard)}
							</div>
						</TabsContent>
						<TabsContent value="windows" className="h-full mt-0">
							<div
								className={`grid h-[282px] auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto pr-1.5 pt-1 ${styles.sourceGridScroll}`}
							>
								{windowSources.map(renderSourceCard)}
							</div>
						</TabsContent>
					</div>
				</Tabs>
			</div>
			<div className="flex justify-center gap-2 border-t border-white/[0.06] p-3">
				<Button
					data-testid="source-selector-cancel-button"
					variant="ghost"
					onClick={() => window.close()}
					className="h-8 rounded-lg px-5 text-[11px] text-zinc-400 transition-transform duration-150 hover:bg-white/5 hover:text-white active:scale-95"
				>
					{tc("actions.cancel")}
				</Button>
				<Button
					data-testid="source-selector-share-button"
					onClick={handleShare}
					disabled={!selectedSource}
					className="h-8 rounded-lg bg-[#34B27B] px-5 text-[11px] font-semibold text-white transition-transform duration-150 hover:bg-[#34B27B]/85 active:scale-95 disabled:bg-zinc-700 disabled:opacity-30"
				>
					{tc("actions.share")}
				</Button>
			</div>
		</div>
	);
}
