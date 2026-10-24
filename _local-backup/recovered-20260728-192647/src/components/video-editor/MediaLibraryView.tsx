import { ArrowLeft, FileVideo2, FolderOpen, Loader2, RefreshCw, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";

export interface MediaLibraryItem {
	path: string;
	kind: "project" | "recording";
	title: string;
	modifiedAt: number;
	fileSize: number;
	hasProject: boolean;
	hasSession: boolean;
}

interface MediaLibraryViewProps {
	onBack: () => void;
	onOpen: (item: MediaLibraryItem) => Promise<void>;
	onOpenFromComputer: () => void;
	onNewRecording: () => void;
}

function formatDate(timestamp: number, locale: string): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
		timestamp,
	);
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function MediaLibraryView({
	onBack,
	onOpen,
	onOpenFromComputer,
	onNewRecording,
}: MediaLibraryViewProps) {
	const t = useScopedT("editor");
	const [items, setItems] = useState<MediaLibraryItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [openingPath, setOpeningPath] = useState<string | null>(null);

	const loadLibrary = useCallback(async () => {
		setLoading(true);
		setError(null);
		const result = await window.electronAPI.listMediaLibrary();
		if (!result.success) {
			setError(result.message || t("mediaLibrary.loadError"));
			setItems([]);
		} else {
			setItems(result.items);
		}
		setLoading(false);
	}, [t]);

	useEffect(() => {
		void loadLibrary();
	}, [loadLibrary]);

	const openItem = async (item: MediaLibraryItem) => {
		setOpeningPath(item.path);
		try {
			await onOpen(item);
		} finally {
			setOpeningPath(null);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-[#09090b] text-white">
			<header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] px-5">
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={onBack}
						className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.07] hover:text-white"
					>
						<ArrowLeft className="h-4 w-4" />
						{t("mediaLibrary.back")}
					</button>
					<div className="h-5 w-px bg-white/10" />
					<div>
						<h1 className="text-sm font-semibold text-slate-100">{t("mediaLibrary.title")}</h1>
						<p className="text-[10px] text-slate-500">{t("mediaLibrary.subtitle")}</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => void loadLibrary()}
						className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/[0.07] hover:text-white"
						title={t("mediaLibrary.refresh")}
					>
						<RefreshCw className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={onOpenFromComputer}
						className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
					>
						<FolderOpen className="h-4 w-4" />
						{t("mediaLibrary.openFromComputer")}
					</button>
				</div>
			</header>

			<main className="min-h-0 flex-1 overflow-y-auto p-6">
				{loading ? (
					<div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
						<Loader2 className="h-4 w-4 animate-spin" />
						{t("mediaLibrary.loading")}
					</div>
				) : error ? (
					<div className="flex h-full flex-col items-center justify-center gap-4 text-center">
						<p className="max-w-md text-sm text-slate-400">{error}</p>
						<button
							type="button"
							onClick={() => void loadLibrary()}
							className="rounded-lg bg-[#34B27B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d9e6c]"
						>
							{t("mediaLibrary.retry")}
						</button>
					</div>
				) : items.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-4 text-center">
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<Video className="h-7 w-7 text-[#34B27B]" />
						</div>
						<div>
							<h2 className="text-base font-semibold text-slate-200">
								{t("mediaLibrary.emptyTitle")}
							</h2>
							<p className="mt-1 text-sm text-slate-500">{t("mediaLibrary.emptyDescription")}</p>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={onNewRecording}
								className="rounded-lg bg-[#34B27B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d9e6c]"
							>
								{t("mediaLibrary.newRecording")}
							</button>
							<button
								type="button"
								onClick={onOpenFromComputer}
								className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]"
							>
								{t("mediaLibrary.openFromComputer")}
							</button>
						</div>
					</div>
				) : (
					<div className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
						{items.map((item) => (
							<button
								key={item.path}
								type="button"
								disabled={openingPath !== null}
								onClick={() => void openItem(item)}
								className="group overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] text-left transition-all hover:-translate-y-0.5 hover:border-[#34B27B]/50 hover:bg-white/[0.05] disabled:opacity-60"
							>
								<div className="flex aspect-video items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(52,178,123,0.2),transparent_50%),#121416]">
									{openingPath === item.path ? (
										<Loader2 className="h-6 w-6 animate-spin text-[#34B27B]" />
									) : item.kind === "project" ? (
										<FileVideo2 className="h-8 w-8 text-[#34B27B]" />
									) : (
										<Video className="h-8 w-8 text-slate-400 group-hover:text-[#34B27B]" />
									)}
								</div>
								<div className="p-3">
									<div className="mb-2 flex items-center justify-between gap-2">
										<span className="rounded bg-[#34B27B]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#6de2aa]">
											{item.kind === "project"
												? t("mediaLibrary.project")
												: t("mediaLibrary.recording")}
										</span>
										{item.kind === "recording" && item.hasProject && (
											<span className="text-[9px] text-slate-500">{t("mediaLibrary.edited")}</span>
										)}
									</div>
									<p className="truncate text-xs font-medium text-slate-200">{item.title}</p>
									<p className="mt-1 text-[10px] text-slate-500">
										{formatDate(item.modifiedAt, "en")} · {formatFileSize(item.fileSize)}
									</p>
								</div>
							</button>
						))}
					</div>
				)}
			</main>
		</div>
	);
}
