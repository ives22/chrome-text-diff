import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  DiffCell,
  DiffResult,
  DiffRow,
  DiffRowKind,
  DiffViewMode,
  MergeDirection,
} from "../core/types";
import { HunkControlHeader, HunkMergeActions } from "./HunkMergeControls";

interface DiffViewerProps {
  result: DiffResult;
  viewMode: DiffViewMode;
  wrapLines: boolean;
  activeHunkIndex: number;
  mergePanelOpen: boolean;
  isComparing: boolean;
  onSelectHunk: (index: number) => void;
  onCloseMergePanel: () => void;
  onPreviousHunk: () => void;
  onNextHunk: () => void;
  onMerge: (direction: MergeDirection) => void;
}

type ContentDisplayRow =
  | { type: "split"; id: string; hunkId?: string; row: DiffRow; isHunkStart?: boolean; isHunkEnd?: boolean }
  | {
      type: "unified";
      id: string;
      hunkId?: string;
      kind: Exclude<DiffRowKind, "change">;
      cell: DiffCell;
      leftLineNumber?: number;
      rightLineNumber?: number;
      isHunkStart?: boolean;
      isHunkEnd?: boolean;
    };

type DisplayRow = ContentDisplayRow | {
  type: "hunk-header";
  id: string;
  hunkId: string;
} | {
  type: "hunk-actions";
  id: string;
  hunkId: string;
};

export function DiffViewer({
  result,
  viewMode,
  wrapLines,
  activeHunkIndex,
  mergePanelOpen,
  isComparing,
  onSelectHunk,
  onCloseMergePanel,
  onPreviousHunk,
  onNextHunk,
  onMerge,
}: DiffViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeHunkId = result.hunks[activeHunkIndex]?.id;
  const displayRows = useMemo(
    () => buildDisplayRows(result.rows, viewMode, mergePanelOpen ? activeHunkId : undefined),
    [activeHunkId, mergePanelOpen, result.rows, viewMode],
  );
  const hunkIndexById = useMemo(
    () => new Map(result.hunks.map((hunk, index) => [hunk.id, index])),
    [result.hunks],
  );
  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateDisplayRowSize(displayRows[index], wrapLines),
    getItemKey: (index) => displayRows[index]?.id ?? index,
    overscan: 18,
    initialRect: { width: 1200, height: 600 },
  });
  const virtualRows = virtualizer.getVirtualItems();
  const fallbackRows = virtualRows.length === 0 && displayRows.length <= 200
    ? buildFallbackVirtualRows(displayRows, wrapLines)
    : [];
  const rowsToRender =
    virtualRows.length > 0
      ? virtualRows
      : fallbackRows;
  const canvasHeight = Math.max(
    virtualizer.getTotalSize(),
    estimateCanvasHeight(displayRows, wrapLines),
  );

  useEffect(() => {
    if (!activeHunkId) return;
    const preferredType = mergePanelOpen ? "hunk-header" : undefined;
    const index = displayRows.findIndex((row) =>
      row.hunkId === activeHunkId && (!preferredType || row.type === preferredType),
    );
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
  }, [activeHunkId, displayRows, mergePanelOpen, virtualizer]);

  useEffect(() => {
    virtualizer.measure();
  }, [displayRows, virtualizer, viewMode, wrapLines]);

  return (
    <section className="diff-viewer" aria-label="差异结果">
      <header className="diff-summary">
        <DiffStat
          kind="remove"
          units={result.stats.removedUnits}
          lines={result.stats.removedLines}
        />
        <DiffStat
          kind="add"
          units={result.stats.addedUnits}
          lines={result.stats.addedLines}
        />
        <div className="stat stat-neutral">{result.stats.unchangedLines} 行未变</div>
        <div className="hunk-summary">{result.stats.hunks} 处差异</div>
      </header>
      <div
        ref={scrollRef}
        className={`diff-scroll ${wrapLines ? "wrap-lines" : "no-wrap"}`}
      >
        <div
          className="virtual-canvas"
          style={{ height: `${canvasHeight}px` }}
        >
          {rowsToRender.map((virtualRow) => {
            const item = displayRows[virtualRow.index];
            if (!item) return null;
            const style: CSSProperties = {
              transform: `translateY(${virtualRow.start}px)`,
            };
            if (item.type === "hunk-header") {
              return (
                <div
                  key={item.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="virtual-row hunk-control-row hunk-control-top"
                  style={style}
                >
                  <HunkControlHeader
                    current={activeHunkIndex + 1}
                    total={result.hunks.length}
                    onPrevious={onPreviousHunk}
                    onNext={onNextHunk}
                    onClose={onCloseMergePanel}
                  />
                </div>
              );
            }
            if (item.type === "hunk-actions") {
              return (
                <div
                  key={item.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="virtual-row hunk-control-row hunk-control-bottom"
                  style={style}
                >
                  <HunkMergeActions
                    viewMode={viewMode}
                    disabled={isComparing}
                    onMerge={onMerge}
                  />
                </div>
              );
            }

            const hunkIndex = item.hunkId ? hunkIndexById.get(item.hunkId) : undefined;
            const isActiveHunk = item.hunkId === activeHunkId;
            const isSelectedHunk = isActiveHunk && mergePanelOpen;
            const selectHunk = () => {
              if (hunkIndex !== undefined) onSelectHunk(hunkIndex);
            };
            return (
              <div
                key={item.id}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className={`virtual-row ${isActiveHunk ? "active-hunk" : ""} ${isSelectedHunk ? "selected-hunk" : ""} ${item.isHunkStart ? "hunk-start" : ""} ${item.isHunkEnd ? "hunk-end" : ""}`}
                style={style}
                role={item.isHunkStart ? "button" : undefined}
                tabIndex={item.isHunkStart ? 0 : undefined}
                aria-label={item.isHunkStart && hunkIndex !== undefined
                  ? `选择第 ${hunkIndex + 1} 处差异进行合并`
                  : undefined}
                onClick={item.hunkId ? selectHunk : undefined}
                onKeyDown={item.isHunkStart ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectHunk();
                  }
                } : undefined}
              >
                {item.type === "split" ? (
                  <SplitRow row={item.row} />
                ) : (
                  <UnifiedRow row={item} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DiffStat({
  kind,
  units,
  lines,
}: {
  kind: "add" | "remove";
  units: number;
  lines: number;
}) {
  const action = kind === "add" ? "新增" : "删除";
  const description = `${units} 个${action}差异单元，影响 ${lines} 行`;

  return (
    <div
      className={`stat stat-${kind}`}
      aria-label={description}
      title={description}
    >
      <span aria-hidden="true">{kind === "add" ? "+" : "−"}</span>
      <strong>{units} {action}</strong>
      <small className="stat-detail">{lines} 行</small>
    </div>
  );
}

function SplitRow({ row }: { row: DiffRow }) {
  return (
    <div className="split-row">
      <DiffCellView side="left" kind={row.kind} cell={row.left} />
      <DiffCellView side="right" kind={row.kind} cell={row.right} />
    </div>
  );
}

function UnifiedRow({ row }: { row: Extract<ContentDisplayRow, { type: "unified" }> }) {
  const marker = row.kind === "add" ? "+" : row.kind === "remove" ? "−" : "";
  const label =
    row.kind === "add"
      ? `新增第 ${row.rightLineNumber} 行`
      : row.kind === "remove"
        ? `删除第 ${row.leftLineNumber} 行`
        : `未更改行 ${row.leftLineNumber}`;

  return (
    <div className={`unified-row row-${row.kind}`} aria-label={label}>
      <span className="line-number">{row.leftLineNumber ?? ""}</span>
      <span className="line-number">{row.rightLineNumber ?? ""}</span>
      <span className="change-marker" aria-hidden="true">{marker}</span>
      <code><Segments cell={row.cell} /></code>
    </div>
  );
}

function DiffCellView({
  side,
  kind,
  cell,
}: {
  side: "left" | "right";
  kind: DiffRowKind;
  cell?: DiffCell;
}) {
  const effectiveKind =
    kind === "change" ? (side === "left" ? "remove" : "add") : kind;
  const marker = !cell ? "" : effectiveKind === "add" ? "+" : effectiveKind === "remove" ? "−" : "";
  const sideLabel = side === "left" ? "左侧" : "右侧";
  const ariaLabel = !cell
    ? `${sideLabel}空白占位`
    : effectiveKind === "add"
      ? `${sideLabel}新增第 ${cell.lineNumber} 行`
      : effectiveKind === "remove"
        ? `${sideLabel}删除第 ${cell.lineNumber} 行`
        : `${sideLabel}未更改第 ${cell.lineNumber} 行`;

  return (
    <div className={`diff-cell row-${cell ? effectiveKind : "empty"}`} aria-label={ariaLabel}>
      <span className="line-number">{cell?.lineNumber ?? ""}</span>
      <span className="change-marker" aria-hidden="true">{marker}</span>
      <code>{cell ? <Segments cell={cell} /> : null}</code>
    </div>
  );
}

function Segments({ cell }: { cell: DiffCell }) {
  if (!cell.segments?.length) return cell.text || " ";
  return cell.segments.map((segment, index) => (
    <span
      key={`${segment.type}-${index}`}
      className={segment.type === "equal" ? undefined : `segment-${segment.type}`}
    >
      {segment.value}
    </span>
  ));
}

function buildDisplayRows(
  rows: DiffRow[],
  viewMode: DiffViewMode,
  expandedHunkId?: string,
): DisplayRow[] {
  const contentRows = buildContentRows(rows, viewMode);
  const bounds = new Map<string, { first: number; last: number }>();
  contentRows.forEach((row, index) => {
    if (!row.hunkId) return;
    const current = bounds.get(row.hunkId);
    bounds.set(row.hunkId, { first: current?.first ?? index, last: index });
  });

  return contentRows.flatMap<DisplayRow>((row, index) => {
    if (!row.hunkId) return [row];
    const bound = bounds.get(row.hunkId);
    const content = {
      ...row,
      isHunkStart: bound?.first === index,
      isHunkEnd: bound?.last === index,
    };
    if (row.hunkId !== expandedHunkId) return [content];

    return [
      ...(bound?.first === index ? [{
        type: "hunk-header" as const,
        id: `${row.hunkId}-controls-header`,
        hunkId: row.hunkId,
      }] : []),
      content,
      ...(bound?.last === index ? [{
        type: "hunk-actions" as const,
        id: `${row.hunkId}-controls-actions`,
        hunkId: row.hunkId,
      }] : []),
    ];
  });
}

function buildContentRows(rows: DiffRow[], viewMode: DiffViewMode): ContentDisplayRow[] {
  if (viewMode === "split") {
    return rows.map((row) => ({ type: "split", id: row.id, hunkId: row.hunkId, row }));
  }

  return rows.flatMap<ContentDisplayRow>((row) => {
    if (row.kind === "change") {
      return [
        ...(row.left
          ? [{
              type: "unified" as const,
              id: `${row.id}-remove`,
              hunkId: row.hunkId,
              kind: "remove" as const,
              cell: row.left,
              leftLineNumber: row.left.lineNumber,
            }]
          : []),
        ...(row.right
          ? [{
              type: "unified" as const,
              id: `${row.id}-add`,
              hunkId: row.hunkId,
              kind: "add" as const,
              cell: row.right,
              rightLineNumber: row.right.lineNumber,
            }]
          : []),
      ];
    }

    const cell = row.left ?? row.right;
    if (!cell) return [];
    return [{
      type: "unified" as const,
      id: row.id,
      hunkId: row.hunkId,
      kind: row.kind,
      cell,
      leftLineNumber: row.left?.lineNumber,
      rightLineNumber: row.right?.lineNumber,
    }];
  });
}

function estimateDisplayRowSize(row: DisplayRow | undefined, wrapLines: boolean): number {
  if (row?.type === "hunk-header") return 40;
  if (row?.type === "hunk-actions") return 46;
  return wrapLines ? 34 : 30;
}

function buildFallbackVirtualRows(rows: DisplayRow[], wrapLines: boolean) {
  let start = 0;
  return rows.map((row, index) => {
    const size = estimateDisplayRowSize(row, wrapLines);
    const item = { index, key: row.id, start, size, end: start + size, lane: 0 };
    start += size;
    return item;
  });
}

function estimateCanvasHeight(rows: DisplayRow[], wrapLines: boolean): number {
  const contentSize = wrapLines ? 34 : 30;
  const controlAdjustment = rows.reduce((total, row) => {
    if (row.type === "hunk-header") return total + 40 - contentSize;
    if (row.type === "hunk-actions") return total + 46 - contentSize;
    return total;
  }, 0);
  return rows.length * contentSize + controlAdjustment;
}
