// Stable geometry + 14px hysteresis prevent a moving insertion gap from changing its own target.
export function nearestInsertion(x, y, boxes) {
  if (!boxes.length) return 0;
  let nearest = 0,
    distance = Infinity;
  boxes.forEach((box, i) => {
    const d =
      Math.abs(x - (box.left + box.width / 2)) +
      Math.abs(y - (box.top + box.height / 2)) * 1.3;
    if (d < distance) {
      nearest = i;
      distance = d;
    }
  });
  return nearest + (x > boxes[nearest].left + boxes[nearest].width / 2 ? 1 : 0);
}
export function bindDrag(area, { getIds, canDrag, render, commit }) {
  let drag,
    suppressedUntil = 0;
  const cleanup = () => {
    drag?.ghost?.remove();
    drag = undefined;
  };
  area.addEventListener("pointerdown", (event) => {
    const target = event.target.closest("[data-answer]");
    if (!target || !canDrag() || event.button !== 0) return;
    const id = target.dataset.answer;
    drag = {
      id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      ids: getIds().filter((x) => x !== id),
      boxes: [...area.querySelectorAll("[data-answer]")]
        .filter((e) => e !== target)
        .map((e) => e.getBoundingClientRect()),
      index: getIds().indexOf(id),
      target,
      active: false,
    };
  });
  const move = (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (
      !drag.active &&
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8
    )
      return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = true;
      drag.ghost = drag.target.cloneNode(true);
      drag.ghost.classList.add("drag-ghost");
      drag.ghost.removeAttribute("data-answer");
      drag.ghost.style.width = `${drag.target.offsetWidth}px`;
      document.body.append(drag.ghost);
    }
    drag.ghost.style.left = `${event.clientX - 55}px`;
    drag.ghost.style.top = `${event.clientY - 26}px`;
    if (
      Math.hypot(event.clientX - drag.lastX, event.clientY - drag.lastY) > 14
    ) {
      drag.index = nearestInsertion(event.clientX, event.clientY, drag.boxes);
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
    }
    if (drag.renderIndex === drag.index) return;
    drag.renderIndex = drag.index;
    const before = new Map(
      [...area.querySelectorAll("[data-answer]")].map((e) => [
        e.dataset.answer,
        e.getBoundingClientRect(),
      ]),
    );
    render(drag.ids, drag.index);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      for (const el of area.querySelectorAll("[data-answer]")) {
        const old = before.get(el.dataset.answer);
        const next = el.getBoundingClientRect();
        if (old)
          el.animate(
            [
              {
                transform: `translate(${old.left - next.left}px,${old.top - next.top}px)`,
              },
              { transform: "none" },
            ],
            { duration: 180, easing: "ease-out" },
          );
      }
  };
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (drag.active) {
      suppressedUntil = Date.now() + 300;
      if (event.type !== "pointercancel") {
        const ids = [...drag.ids];
        ids.splice(drag.index, 0, drag.id);
        commit(ids);
      } else render(getIds());
    }
    cleanup();
  };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  return {
    suppressClick: () => Date.now() < suppressedUntil,
    destroy() {
      cleanup();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    },
  };
}
