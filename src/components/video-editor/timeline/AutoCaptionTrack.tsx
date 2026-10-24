import { useItem } from "dnd-timeline";
import { Captions } from "lucide-react";
import { useMemo } from "react";
import type { AnnotationRegion } from "../types";

const AUTO_CAPTION_TRACK_ITEM_ID = "auto-caption-track";

interface AutoCaptionTrackProps {
	rowId: string;
	regions: AnnotationRegion[];
	label?: string;
	selectedId?: string | null;
	onSelect?: () => void;
}

/** One visual timeline item whose cue boundaries are decorative, not individually selectable. */
export default function AutoCaptionTrack({
	rowId,
	regions,
	label = "Captions",
	selectedId,
	onSelect,
}: AutoCaptionTrackProps) {
	const sorted = useMemo(
		() => [...regions].sort((left, right) => left.startMs - right.startMs),
		[regions],
	);
	const span = useMemo(
		() => ({
			start: sorted[0]?.startMs ?? 0,
			end: sorted.at(-1)?.endMs ?? 1,
		}),
		[sorted],
	);
	const { setNodeRef, itemStyle, itemContentStyle } = useItem({
		id: AUTO_CAPTION_TRACK_ITEM_ID,
		span,
		data: { rowId },
	});
	const duration = Math.max(1, span.end - span.start);
	const isSelected = sorted.some((region) => region.id === selectedId);

	const selectTrack = (event: React.PointerEvent<HTMLDivElement>) => {
		event.stopPropagation();
		onSelect?.();
	};

	return (
		<div ref={setNodeRef} style={{ ...itemStyle, minWidth: 24 }} className="group">
			<div style={{ ...itemContentStyle, minWidth: 24 }}>
				<div
					className={`relative flex h-[30px] w-full cursor-pointer items-center overflow-hidden rounded-md border bg-gradient-to-b from-[#9d8a38]/75 to-[#655923]/85 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors ${
						isSelected
							? "border-white/70 ring-1 ring-inset ring-white/55"
							: "border-[#d8bf58]/45 hover:border-[#e7d276]/70"
					}`}
					onPointerDown={selectTrack}
					onClick={(event) => event.stopPropagation()}
					title={label}
				>
					{sorted.map((region) => {
						const left = ((region.startMs - span.start) / duration) * 100;
						const width = Math.max(0.08, ((region.endMs - region.startMs) / duration) * 100);
						return (
							<div
								key={region.id}
								className="pointer-events-none absolute inset-y-0 border-l border-white/20"
								style={{ left: `${left}%`, width: `${width}%` }}
							/>
						);
					})}
					<div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-1.5 px-3 text-white/95">
						<Captions className="h-3.5 w-3.5 shrink-0" />
						<span className="truncate whitespace-nowrap text-[11px] font-semibold">
							{label} · {sorted.length}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
