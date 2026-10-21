export function $(id) {
  return document.getElementById(id);
}

/**
 * Small element builder so DOM-heavy render functions (chat, gate) don't
 * turn into a wall of manual createElement/append calls.
 *
 *   el("button", { class: "button primary", onClick: handler }, ["Send"])
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "checked") node.checked = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** References a symbol from the inline sprite in index.html (`#icon-NAME`). */
export function icon(name, extraClass = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `icon ${extraClass}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

/**
 * Renders a set of options as an accessible segmented control: real radio
 * inputs immediately followed by their label, styled in CSS via the classic
 * `input:checked + label` sibling selector.
 */
export function renderPillGroup(container, { name, options, selectedValue }) {
  container.replaceChildren();
  options.forEach((option, index) => {
    const id = `${name}-${index}`;
    container.append(
      el("input", { type: "radio", name, id, value: String(option.value), checked: option.value === selectedValue }),
      el("label", { for: id, text: option.label }),
    );
  });
}

export function getPillValue(container) {
  const checked = container.querySelector("input:checked");
  return checked ? Number(checked.value) : undefined;
}
