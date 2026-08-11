export interface InputFileDescriptor {
  name: string;
  size: number;
}
export interface InputValidation {
  ok: boolean;
  message?: string;
}

const MIB = 1024 * 1024;

export function validateInputEnvelope(
  files: readonly InputFileDescriptor[],
): InputValidation {
  if (files.length === 0)
    return {
      ok: false,
      message: "Choose a ZIP file or one to sixteen JSON files.",
    };
  if (files.some((file) => file.name.endsWith("/") || file.name.includes("\\")))
    return { ok: false, message: "Folders are not supported." };
  const zip = files.filter((file) => file.name.toLowerCase().endsWith(".zip"));
  const json = files.filter((file) =>
    file.name.toLowerCase().endsWith(".json"),
  );
  if (zip.length === 1 && files.length === 1)
    return (zip[0]?.size ?? Number.POSITIVE_INFINITY) <= 64 * MIB
      ? { ok: true }
      : { ok: false, message: "ZIP files must not exceed 64 MiB." };
  if (json.length !== files.length)
    return {
      ok: false,
      message: "Do not mix ZIP, JSON, or unsupported file types.",
    };
  if (json.length > 16)
    return { ok: false, message: "Choose no more than sixteen JSON files." };
  if (json.some((file) => file.size > 64 * MIB))
    return { ok: false, message: "Each JSON file must not exceed 64 MiB." };
  if (json.reduce((sum, file) => sum + file.size, 0) > 128 * MIB)
    return { ok: false, message: "The JSON set must not exceed 128 MiB." };
  return { ok: true };
}
