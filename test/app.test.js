const test = require("node:test");
const assert = require("node:assert");
const { markdownToHtml, safeImageUrl } = require("../index.js");

test("renders a markdown table", () => {
  const html = markdownToHtml("| A | B |\n|---|---|\n| 1 | 2 |");
  assert.match(html, /<th>A<\/th><th>B<\/th>/);
  assert.match(html, /<td>1<\/td><td>2<\/td>/);
});

test("escapes HTML in cells and paragraphs", () => {
  assert.ok(!markdownToHtml("| A |\n|---|\n| <img src=x onerror=alert(1)> |").includes("<img"));
  assert.ok(!markdownToHtml("<script>alert(1)</script>").includes("<script>"));
});

test("only allows http(s) image URLs", () => {
  assert.strictEqual(safeImageUrl("javascript:alert(1)"), "");
  assert.strictEqual(safeImageUrl("not a url"), "");
  assert.strictEqual(safeImageUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
});
