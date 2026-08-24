import assert from "node:assert/strict";
import process from "node:process";
import { serialize, deserialize } from "node:v8";
import {
  approvedDocumentBindingsPass,
  mainProcessZoomCallLogPasses,
  rectWithinHorizontalBounds,
  rectanglesOverlap,
  screenshotTargetPasses,
  viewWidthMatches,
  zoomContractPasses,
  zoomReadbackMatches,
} from "./m03-runtime-contracts.mjs";

const rect = (x, y, width, height) => ({
  x,
  y,
  width,
  height,
  right: x + width,
  bottom: y + height,
});
const clone = (value) => deserialize(serialize(value));
const viewRect = rect(10, 20, 360, 600);
const passingMetrics = {
  viewRect,
  viewClientWidth: 360,
  viewScrollWidth: 361,
  sourceRegionRect: rect(10, 30, 360, 300),
  rawPreviewRect: rect(11, 100, 358, 100),
  controls: [
    {
      label: "Preview source note",
      enabled: true,
      visible: true,
      rect: rect(20, 40, 120, 30),
    },
    {
      label: "Save source note",
      enabled: true,
      visible: true,
      rect: rect(150, 40, 120, 30),
    },
  ],
};
const focusTransitions = [
  { input: "programmatic-start", label: "Other" },
  { input: "Tab", label: "Preview source note" },
  { input: "Tab", label: "Save source note" },
];
const contract = (overrides = {}) => ({
  zoom1: 1,
  zoom2: 2,
  animationFrameTurns: 2,
  metrics: clone(passingMetrics),
  focusTransitions: clone(focusTransitions),
  ...overrides,
});

for (const width of [358, 360, 362])
  assert.equal(viewWidthMatches(width), true);
for (const width of [357.999, 362.001])
  assert.equal(viewWidthMatches(width), false);
assert.equal(zoomReadbackMatches(1.001, 1), true);
assert.equal(zoomReadbackMatches(2.001, 2), true);
assert.equal(zoomReadbackMatches(2.0011, 2), false);
assert.equal(rectWithinHorizontalBounds(rect(9, 20, 362, 20), viewRect), true);
assert.equal(
  rectWithinHorizontalBounds(rect(8.9, 20, 362, 20), viewRect),
  false,
);
assert.equal(rectWithinHorizontalBounds(rect(10, 20, 0, 20), viewRect), false);
assert.equal(
  rectanglesOverlap(rect(10, 10, 10, 10), rect(20, 10, 10, 10)),
  false,
);
assert.equal(
  rectanglesOverlap(rect(10, 10, 11, 10), rect(20, 10, 10, 10)),
  true,
);
assert.equal(zoomContractPasses(contract()), true);

for (const failing of [
  contract({ zoom1: 1.002 }),
  contract({ zoom2: 1.999 - Number.EPSILON }),
  contract({ animationFrameTurns: 1 }),
  contract({ focusTransitions: focusTransitions.slice(0, 2) }),
  contract({
    metrics: { ...clone(passingMetrics), viewScrollWidth: 361.01 },
  }),
  contract({
    metrics: {
      ...clone(passingMetrics),
      controls: [
        passingMetrics.controls[0],
        { ...passingMetrics.controls[1], enabled: false },
      ],
    },
  }),
  contract({
    metrics: {
      ...clone(passingMetrics),
      controls: [
        passingMetrics.controls[0],
        { ...passingMetrics.controls[1], rect: rect(100, 40, 120, 30) },
      ],
    },
  }),
])
  assert.equal(zoomContractPasses(failing), false);

assert.equal(zoomReadbackMatches(1, 1), true, "restore readback contract");
assert.equal(
  approvedDocumentBindingsPass({
    frozenSpec: {
      bytes: 261_437,
      sha256:
        "ad8f548e1ca264c569c75030a7f3f0fb6430ceee3838b08e4071c6400b672791",
    },
    scopeAmendment: {
      bytes: 10_932,
      sha256:
        "6cd26a318e74e7299376020cbf37608a267bf903d068aacf6debdfdc5bc02dad",
    },
  }),
  true,
);
assert.equal(approvedDocumentBindingsPass({ frozenSpec: {} }), false);

const zoomCall = (zoomFactor) => ({
  request: {
    method: "Runtime.evaluate",
    params: {
      expression: `contents.setZoomFactor(${String(zoomFactor)});return contents.getZoomFactor()`,
    },
  },
  response: { result: { result: { value: zoomFactor } } },
});
assert.equal(
  mainProcessZoomCallLogPasses([zoomCall(1), zoomCall(2), zoomCall(1)]),
  true,
);
assert.equal(mainProcessZoomCallLogPasses([zoomCall(1), zoomCall(2)]), false);
assert.equal(
  screenshotTargetPasses({
    leafVisible: true,
    leafActive: true,
    viewInDocument: true,
    previewVisible: true,
    saveVisible: true,
    rawPreviewVisible: true,
  }),
  true,
);
assert.equal(
  screenshotTargetPasses({
    leafVisible: true,
    leafActive: false,
    viewInDocument: true,
    previewVisible: true,
    saveVisible: true,
    rawPreviewVisible: true,
  }),
  false,
);
process.stdout.write("M03 runtime contract helpers passed (28 assertions).\n");
