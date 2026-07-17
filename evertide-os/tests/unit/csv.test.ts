import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/logic/csv";

describe("CSV export (§7.4)", () => {
  it("escapes quotes, commas, and newlines per RFC 4180", () => {
    const csv = toCsv(["A", "B"], [['He said "hi"', "one,two"], ["line1\nline2", null]]);
    expect(csv).toBe('A,B\r\n"He said ""hi""","one,two"\r\n"line1\nline2",\r\n');
  });

  it("renders numbers and empty cells", () => {
    const csv = toCsv(["n"], [[42], [undefined]]);
    expect(csv).toBe("n\r\n42\r\n\r\n");
  });
});
