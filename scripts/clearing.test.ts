// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearMarket } from "../lib/game.ts";

const offer = (groupId: number, price: number, quantity = 100) => ({ groupId, price, quantity });
const byGroup = (r: ReturnType<typeof clearMarket>) => Object.fromEntries(r.dispatch.map((x) => [x.groupId, x]));

test("each accepted team is paid its own offer", () => {
  const r = clearMarket(250, [offer(1, 20), offer(2, 50), offer(3, 80)]);
  const d = byGroup(r);
  assert.equal(d[1].profit, 20 * 100);
  assert.equal(d[2].profit, 50 * 100);
  assert.equal(d[3].dispatched, 50);
  assert.equal(d[3].profit, 80 * 50);
  assert.equal(r.marginalPrice, 80);
  assert.equal(r.clearingPrice, 44); // (2000 + 5000 + 4000) / 250
});

test("offers are bought from cheapest to most expensive", () => {
  const r = clearMarket(200, [offer(1, 90), offer(2, 10), offer(3, 50)]);
  assert.deepEqual(r.dispatch.map((x) => x.dispatched), [0, 100, 100]);
  assert.equal(r.marginalPrice, 50);
});

test("ties at the margin share demand pro rata", () => {
  const r = clearMarket(150, [offer(1, 50), offer(2, 50)]);
  assert.deepEqual(r.dispatch.map((x) => x.dispatched), [75, 75]);
  assert.equal(r.clearingPrice, 50);
});

test("a cartel at the cap shares demand equally", () => {
  const r = clearMarket(300, [1, 2, 3, 4].map((id) => offer(id, 200)));
  assert.deepEqual(r.dispatch.map((x) => x.dispatched), [75, 75, 75, 75]);
  assert.equal(r.clearingPrice, 200);
});

test("undercutting the cartel by 1 € sells the full plant", () => {
  const r = clearMarket(300, [offer(1, 199), offer(2, 200), offer(3, 200), offer(4, 200)]);
  const d = byGroup(r);
  assert.equal(d[1].dispatched, 100);
  assert.equal(d[1].profit, 19900);
  assert.equal(d[2].dispatched, 66.67);
});

test("when supply falls short everything is sold at its own price", () => {
  const r = clearMarket(300, [offer(1, 30), offer(2, 40)]);
  assert.equal(r.shortfallMw, 100);
  assert.equal(r.clearingPrice, 35);
});

test("zero-quantity offers are ignored", () => {
  const r = clearMarket(50, [offer(1, 0, 0), offer(2, 40)]);
  assert.equal(r.marginalPrice, 40);
  assert.equal(r.clearingPrice, 40);
});
