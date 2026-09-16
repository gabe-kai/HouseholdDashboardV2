import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type OrderedListItem = {
  id: string;
  label: string;
};

type DragState = {
  itemId: string;
  fromIndex: number;
  currentIndex: number;
  pointerId: number;
  startY: number;
  offsetY: number;
  originOrder: string[];
};

function reorderIds(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) {
    return ids;
  }
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

function indexFromPointerY(
  clientY: number,
  container: HTMLElement,
  itemCount: number,
): number {
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-ordered-row]"));
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i += 1) {
    const rect = rows[i]!.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) return Math.min(i, itemCount - 1);
  }
  return itemCount - 1;
}

function autoscroll(container: HTMLElement, clientY: number) {
  const rect = container.getBoundingClientRect();
  const edge = 48;
  if (clientY < rect.top + edge) {
    container.scrollTop -= 12;
  } else if (clientY > rect.bottom - edge) {
    container.scrollTop += 12;
  }
}

export function OrderedList<T extends OrderedListItem>(props: {
  items: T[];
  onReorder: (next: T[]) => void;
  renderRow: (item: T, index: number) => ReactNode;
  /** When false, rows are display-only (no drag/move). */
  reorderable?: boolean;
  listLabel?: string;
}) {
  const reorderable = props.reorderable !== false;
  const listId = useId();
  const liveId = `${listId}-live`;
  const containerRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    if (!menuOpenId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpenId(null);
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      const menu = document.getElementById(`${listId}-menu-${menuOpenId}`);
      if (menu && !menu.contains(target)) setMenuOpenId(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpenId, listId]);

  function announce(item: T, index: number) {
    setAnnouncement(`${item.label}, position ${index + 1} of ${props.items.length}`);
  }

  function applyOrder(ids: string[]) {
    const byId = new Map(props.items.map((item) => [item.id, item]));
    const next = ids.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
    if (next.length === props.items.length) props.onReorder(next);
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= props.items.length) return;
    const ids = props.items.map((item) => item.id);
    const nextIds = reorderIds(ids, index, target);
    applyOrder(nextIds);
    const item = props.items[index]!;
    announce(item, target);
    // Keep focus with the moved control via announcement; row remounts keep id.
    requestAnimationFrame(() => {
      const handle = containerRef.current?.querySelector<HTMLElement>(
        `[data-ordered-id="${item.id}"] [data-row-menu-trigger]`,
      );
      handle?.focus();
    });
  }

  function cancelDrag() {
    const current = dragRef.current;
    if (!current) return;
    applyOrder(current.originOrder);
    setDrag(null);
    const item = props.items.find((entry) => entry.id === current.itemId);
    if (item) announce(item, current.fromIndex);
  }

  function finishDrag() {
    const current = dragRef.current;
    if (!current) return;
    setDrag(null);
    const item = props.items.find((entry) => entry.id === current.itemId);
    if (item) announce(item, current.currentIndex);
  }

  useEffect(() => {
    if (!drag) return;

    function onPointerMove(event: PointerEvent) {
      const current = dragRef.current;
      const container = containerRef.current;
      if (!current || !container || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      autoscroll(container, event.clientY);
      const nextIndex = indexFromPointerY(event.clientY, container, props.items.length);
      const ids = reorderIds(current.originOrder, current.fromIndex, nextIndex);
      applyOrder(ids);
      setDrag({
        ...current,
        currentIndex: nextIndex,
        offsetY: event.clientY - current.startY,
      });
    }

    function onPointerUp(event: PointerEvent) {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      finishDrag();
    }

    function onPointerCancel(event: PointerEvent) {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      cancelDrag();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelDrag();
      }
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag?.itemId, drag?.pointerId]);

  function onHandlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (!reorderable || event.button !== 0) return;
    const item = props.items[index];
    if (!item) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const originOrder = props.items.map((entry) => entry.id);
    setMenuOpenId(null);
    setDrag({
      itemId: item.id,
      fromIndex: index,
      currentIndex: index,
      pointerId: event.pointerId,
      startY: event.clientY,
      offsetY: 0,
      originOrder,
    });
  }

  return (
    <div className="ordered-list">
      <div id={liveId} className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
      <ul
        ref={containerRef}
        className="ordered-list-rows"
        aria-label={props.listLabel ?? "Ordered items"}
        aria-describedby={liveId}
      >
        {props.items.map((item, index) => {
          const dragging = drag?.itemId === item.id;
          const style: CSSProperties | undefined = dragging
            ? { transform: `translateY(${drag.offsetY}px)`, zIndex: 2 }
            : undefined;
          return (
            <li
              key={item.id}
              data-ordered-row
              data-ordered-id={item.id}
              className={`ordered-row${dragging ? " is-dragging" : ""}`}
              style={style}
            >
              {reorderable ? (
                <button
                  type="button"
                  className="drag-handle"
                  aria-label={`Drag to reorder ${item.label}`}
                  aria-describedby={liveId}
                  style={{ touchAction: "none" }}
                  onPointerDown={(event) => onHandlePointerDown(event, index)}
                >
                  <span aria-hidden="true">⋮⋮</span>
                </button>
              ) : null}
              <div className="ordered-row-body">{props.renderRow(item, index)}</div>
              {reorderable ? (
                <div className="ordered-row-menu">
                  <button
                    type="button"
                    className="icon-menu-trigger"
                    data-row-menu-trigger
                    aria-label={`More actions for ${item.label}`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpenId === item.id}
                    onClick={() =>
                      setMenuOpenId((current) => (current === item.id ? null : item.id))
                    }
                  >
                    ⋯
                  </button>
                  {menuOpenId === item.id ? (
                    <div
                      id={`${listId}-menu-${item.id}`}
                      className="more-menu-panel ordered-row-menu-panel"
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        disabled={index === 0}
                        onClick={() => {
                          setMenuOpenId(null);
                          moveItem(index, -1);
                        }}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={index === props.items.length - 1}
                        onClick={() => {
                          setMenuOpenId(null);
                          moveItem(index, 1);
                        }}
                      >
                        Move down
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
