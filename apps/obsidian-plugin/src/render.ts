import { boundText } from "./model.js";

export function renderText(
  element: HTMLElement,
  value: string,
  maximum = 16_384,
): void {
  element.textContent = boundText(value, maximum);
}
