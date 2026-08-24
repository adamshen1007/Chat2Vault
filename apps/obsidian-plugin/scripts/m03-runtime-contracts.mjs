export const ZOOM_READBACK_TOLERANCE = 0.001;
export const VIEW_WIDTH_MIN = 358;
export const VIEW_WIDTH_MAX = 362;
export const HORIZONTAL_TOLERANCE = 1;
export const APPROVED_DOCUMENTS = {
  frozenSpec: {
    bytes: 261_437,
    sha256: "ad8f548e1ca264c569c75030a7f3f0fb6430ceee3838b08e4071c6400b672791",
  },
  scopeAmendment: {
    bytes: 10_932,
    sha256: "6cd26a318e74e7299376020cbf37608a267bf903d068aacf6debdfdc5bc02dad",
  },
};

export function approvedDocumentBindingsPass(bindings) {
  return Object.entries(APPROVED_DOCUMENTS).every(
    ([name, approved]) =>
      bindings?.[name]?.bytes === approved.bytes &&
      bindings[name].sha256 === approved.sha256,
  );
}

export function mainProcessZoomCallLogPasses(callLog) {
  const zoomCalls = callLog.filter((entry) => {
    const expression = entry.request?.params?.expression;
    return (
      entry.request?.method === "Runtime.evaluate" &&
      typeof expression === "string" &&
      expression.includes("setZoomFactor(") &&
      expression.includes("getZoomFactor()")
    );
  });
  const expected = [1, 2, 1];
  return (
    zoomCalls.length === expected.length &&
    zoomCalls.every((entry, index) =>
      zoomReadbackMatches(
        entry.response?.result?.result?.value,
        expected[index],
      ),
    )
  );
}

export function screenshotTargetPasses(target) {
  return [
    "leafVisible",
    "leafActive",
    "viewInDocument",
    "previewVisible",
    "saveVisible",
    "rawPreviewVisible",
  ].every((key) => target?.[key] === true);
}

export function zoomReadbackMatches(actual, expected) {
  return (
    Number.isFinite(actual) &&
    Math.abs(actual - expected) <= ZOOM_READBACK_TOLERANCE
  );
}

export function viewWidthMatches(width) {
  return width >= VIEW_WIDTH_MIN && width <= VIEW_WIDTH_MAX;
}

export function rectWithinHorizontalBounds(rect, viewRect) {
  return (
    rect !== null &&
    rect !== undefined &&
    viewRect !== null &&
    viewRect !== undefined &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x >= viewRect.x - HORIZONTAL_TOLERANCE &&
    rect.right <= viewRect.right + HORIZONTAL_TOLERANCE
  );
}

export function rectanglesOverlap(left, right) {
  return (
    left.x < right.right &&
    left.right > right.x &&
    left.y < right.bottom &&
    left.bottom > right.y
  );
}

export function zoomContractPasses({
  zoom1,
  zoom2,
  animationFrameTurns,
  metrics,
  focusTransitions,
}) {
  if (
    !zoomReadbackMatches(zoom1, 1) ||
    !zoomReadbackMatches(zoom2, 2) ||
    animationFrameTurns !== 2 ||
    metrics === undefined ||
    !viewWidthMatches(metrics.viewClientWidth) ||
    metrics.viewScrollWidth > metrics.viewClientWidth + HORIZONTAL_TOLERANCE ||
    !rectWithinHorizontalBounds(metrics.sourceRegionRect, metrics.viewRect) ||
    !rectWithinHorizontalBounds(metrics.rawPreviewRect, metrics.viewRect)
  )
    return false;

  const preview = metrics.controls?.find(
    (control) => control.label === "Preview source note",
  );
  const save = metrics.controls?.find(
    (control) => control.label === "Save source note" && control.enabled,
  );
  if (
    preview === undefined ||
    save === undefined ||
    !metrics.controls.every(
      (control) =>
        control.visible &&
        rectWithinHorizontalBounds(control.rect, metrics.viewRect),
    ) ||
    rectanglesOverlap(preview.rect, save.rect)
  )
    return false;

  return ["Preview source note", "Save source note"].every((label) =>
    focusTransitions.some(
      (transition) => transition.input === "Tab" && transition.label === label,
    ),
  );
}
