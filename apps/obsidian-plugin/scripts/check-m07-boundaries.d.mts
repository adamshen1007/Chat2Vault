export interface M07BoundaryResult {
  ok: boolean;
  failures: string[];
}

export function checkM07BoundarySource(source: string): M07BoundaryResult;
export function checkM07DedupControllerSource(
  source: string,
): M07BoundaryResult;
export function checkM07PinnedSource(source: string): M07BoundaryResult;
export function checkM07PinnedArtifact(source: string): M07BoundaryResult;
export function checkM07BoundaryArtifact(source: string): M07BoundaryResult;
export function checkM07WiringSource(
  source: string,
  constructorName: string,
): M07BoundaryResult;
