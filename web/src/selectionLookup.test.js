import { describe, expect, it } from "vitest";
import { buildLookup, matchSelection } from "./selectionLookup.js";

const nodes = [
  { id: 1, name: "李明远", aliases: ["老李"] },
  { id: 2, name: "石神", aliases: [] },
  { id: 3, name: "李小明", aliases: [] }
];

describe("matchSelection", () => {
  const lookup = buildLookup(nodes);

  it("精确匹配人名", () => {
    expect(matchSelection("石神", lookup)).toMatchObject({ id: 2, exact: true });
  });

  it("精确匹配别名", () => {
    expect(matchSelection("老李", lookup)).toMatchObject({ id: 1, exact: true });
  });

  it("宽松匹配：选区被唯一人名包含", () => {
    expect(matchSelection("明远", lookup)).toMatchObject({ id: 1, exact: false });
  });

  it("宽松匹配多候选时不命中", () => {
    // "李" 同时是 李明远 / 李小明 的子串 → 多候选 → null
    expect(matchSelection("李", lookup)).toBeNull();
  });

  it("空白与超长选区不命中", () => {
    expect(matchSelection("  ", lookup)).toBeNull();
    expect(matchSelection("一二三四五六七八九十一二三", lookup)).toBeNull();
  });

  it("未收录名字不命中", () => {
    expect(matchSelection("汤川", lookup)).toBeNull();
  });
});
