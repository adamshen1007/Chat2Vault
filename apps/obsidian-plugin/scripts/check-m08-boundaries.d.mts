export interface M08BoundaryResult {
  ok: boolean;
  failures: string[];
}

export const M08_PRODUCTION_INVENTORY: readonly string[];
export function checkM08CaptureSource(
  source: string,
  fileName?: string,
): M08BoundaryResult;
export function checkM08CaptureArtifact(source: string): M08BoundaryResult;
export function checkM08ProductionInventory(
  paths: readonly string[],
): M08BoundaryResult;
