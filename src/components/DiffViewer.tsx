import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  DiffCell,
  DiffResult,
  DiffRow,
  DiffRowKind,
  DiffViewMode,
} from "../core/types";

interface DiffViewerProps {
  result: DiffResult;
  viewMode: DiffViewMode;
  wrapLines: boolean;
  activeHunkIndex: number;
}

type DisplayRow =
  | { type: "split"; id: string; hunkId?: string; row: DiffRow }
  | {
      type: "unified";
      id: string;
      hunkId?: string;
      kind: Exclude<DiffRowKind, "change">;
      cell: DiffCell;
      leftLineNumber?: number;
      rightLineNumber?: number;
    };

export function DiffViewer({ result, viewMode, wrapLines, activeHunkIndex }: DiffViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayRows = useMemo(() => buildDisplayRows(result.rows, viewMode), [result.rows, viewMode]);
  const activeHunkId = result.hunks[activeHunkIndex]?.id;
  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (wrapLines ? 34 : 30),
    overscan: 18,
    initialRect: { width: 1200, height: 600 },
  });
  const virtualRows = virtualizer.getVirtualItems();
  const estimatedRowSize = wrapLines ? 34 : 30;
  const rowsToRender =
    virtualRows.length > 0
      ? virtualRows
      : displayRows.length <= 200
        ? displayRows.map((_, index) => ({
            index,
            key: index,
            start: index * estimatedRowSize,
            size: estimatedRowSize,
            end: (index + 1) * estimatedRowSize,
            lane: 0,
          }))
        : [];
  const canvasHeight = Math.max(
    virtualizer.getTotalSize(),
    displayRows.length * estimatedRowSize,
  );

  useEffect(() => {
    if (!activeHunkId) return;
    const index = displayRows.findIndex((row) => row.hunkId === activeHunkId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
  }, [activeHunkId, displayRows, virtualizer]);

  return (
    <section className="diff-viewer" aria-label="差异结果">
      <header className="diff-summary">
        <div className="stat stat-remove"><span aria-hidden="true">−</span>{result.stats.removed} 行删除</div>
        <div className="stat stat-add"><span aria-hidden="true">+</span>{result.stats.added} 行新增</div>
        <div className="stat stat-neutral">{result.stats.unchanged} 行未变</div>
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
            return (
              <div
                key={item.id}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className={`virtual-row ${item.hunkId === activeHunkId ? "active-hunk" : ""}`}
                style={style}
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

function SplitRow({ row }: { row: DiffRow }) {
  return (
    <div className="split-row">
      <DiffCellView side="left" kind={row.kind} cell={row.left} />
      <DiffCellView side="right" kind={row.kind} cell={row.right} />
    </div>
  );
}

function UnifiedRow({ row }: { row: Extract<DisplayRow, { type: "unified" }> }) {
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

function buildDisplayRows(rows: DiffRow[], viewMode: DiffViewMode): DisplayRow[] {
  if (viewMode === "split") {
    return rows.map((row) => ({ type: "split", id: row.id, hunkId: row.hunkId, row }));
  }

  return rows.flatMap<DisplayRow>((row) => {
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
