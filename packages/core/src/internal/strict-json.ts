export interface StrictJsonOptions {
  maxContainerDepth?: number;
  rejectPrototypeNames?: boolean;
  rejectLiteralUnpairedSurrogates?: boolean;
}

function hasLiteralUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

class StrictJsonParser {
  private index = 0;

  public constructor(
    private readonly source: string,
    private readonly options: StrictJsonOptions,
  ) {}

  public parse(): unknown {
    this.whitespace();
    const value = this.value(1);
    this.whitespace();
    if (this.index !== this.source.length) throw new Error("trailing");
    return value;
  }

  private whitespace(): void {
    while (
      this.source[this.index] === " " ||
      this.source[this.index] === "\t" ||
      this.source[this.index] === "\n" ||
      this.source[this.index] === "\r"
    )
      this.index += 1;
  }

  private value(containerDepth: number): unknown {
    const current = this.source[this.index];
    if (current === '"') return this.string();
    if (current === "{") return this.object(containerDepth);
    if (current === "[") return this.array(containerDepth);
    if (current === "t") return this.literal("true", true);
    if (current === "f") return this.literal("false", false);
    if (current === "n") return this.literal("null", null);
    if (current === "-" || (current !== undefined && /[0-9]/u.test(current)))
      return this.number();
    throw new Error("value");
  }

  private literal<T>(text: string, value: T): T {
    if (this.source.slice(this.index, this.index + text.length) !== text)
      throw new Error("literal");
    this.index += text.length;
    return value;
  }

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(this.index),
    );
    if (match === null) throw new Error("number");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error("number-range");
    return value;
  }

  private unicodeEscape(): string {
    const hex = this.source.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/u.test(hex)) throw new Error("unicode");
    this.index += 4;
    const first = Number.parseInt(hex, 16);
    if (first >= 0xd800 && first <= 0xdbff) {
      if (this.source.slice(this.index, this.index + 2) !== "\\u")
        throw new Error("surrogate");
      this.index += 2;
      const lowHex = this.source.slice(this.index, this.index + 4);
      if (!/^[0-9a-fA-F]{4}$/u.test(lowHex)) throw new Error("surrogate");
      this.index += 4;
      const low = Number.parseInt(lowHex, 16);
      if (low < 0xdc00 || low > 0xdfff) throw new Error("surrogate");
      return String.fromCodePoint(
        0x10000 + ((first - 0xd800) << 10) + (low - 0xdc00),
      );
    }
    if (first >= 0xdc00 && first <= 0xdfff) throw new Error("surrogate");
    return String.fromCharCode(first);
  }

  private string(): string {
    this.index += 1;
    let output = "";
    while (this.index < this.source.length) {
      const current = this.source[this.index++];
      if (current === undefined) throw new Error("string");
      if (current === '"') return output;
      if (current.charCodeAt(0) <= 0x1f) throw new Error("control");
      if (current !== "\\") {
        output += current;
        continue;
      }
      const escaped = this.source[this.index++];
      if (escaped === '"' || escaped === "\\" || escaped === "/")
        output += escaped;
      else if (escaped === "b") output += "\b";
      else if (escaped === "f") output += "\f";
      else if (escaped === "n") output += "\n";
      else if (escaped === "r") output += "\r";
      else if (escaped === "t") output += "\t";
      else if (escaped === "u") output += this.unicodeEscape();
      else throw new Error("escape");
    }
    throw new Error("string");
  }

  private assertDepth(depth: number): void {
    if (
      this.options.maxContainerDepth !== undefined &&
      depth > this.options.maxContainerDepth
    )
      throw new Error("depth");
  }

  private array(depth: number): unknown[] {
    this.assertDepth(depth);
    this.index += 1;
    this.whitespace();
    const result: unknown[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    for (;;) {
      result.push(this.value(depth + 1));
      this.whitespace();
      const current = this.source[this.index++];
      if (current === "]") return result;
      if (current !== ",") throw new Error("array");
      this.whitespace();
    }
  }

  private object(depth: number): Record<string, unknown> {
    this.assertDepth(depth);
    this.index += 1;
    this.whitespace();
    const entries: [string, unknown][] = [];
    const names = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return {};
    }
    for (;;) {
      if (this.source[this.index] !== '"') throw new Error("member");
      const name = this.string();
      if (
        names.has(name) ||
        (this.options.rejectPrototypeNames === true &&
          (name === "__proto__" ||
            name === "prototype" ||
            name === "constructor"))
      )
        throw new Error("member-name");
      names.add(name);
      this.whitespace();
      if (this.source[this.index++] !== ":") throw new Error("colon");
      this.whitespace();
      entries.push([name, this.value(depth + 1)]);
      this.whitespace();
      const current = this.source[this.index++];
      if (current === "}") return Object.fromEntries(entries);
      if (current !== ",") throw new Error("object");
      this.whitespace();
    }
  }
}

export function parseStrictJson(
  source: string,
  options: StrictJsonOptions = {},
): unknown {
  if (
    options.rejectLiteralUnpairedSurrogates === true &&
    hasLiteralUnpairedSurrogate(source)
  )
    throw new Error("literal-surrogate");
  return new StrictJsonParser(source, options).parse();
}
