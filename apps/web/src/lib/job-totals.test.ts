import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeJobTotals } from "./job-payments";

const none = {
  taxRatePercent: 0,
  taxServices: false,
  taxProducts: false,
  taxExempt: false,
  discountType: null,
  discountValue: 0,
};
const labor = [{ quantity: 1, unitPrice: "60.00" }];
const parts = [{ quantity: 2, unitPrice: "20.00" }];

describe("computeJobTotals", () => {
  it("with no tax or discount, the total is the line items — as before", () => {
    const t = computeJobTotals({ ...none, jobServices: labor, jobProducts: parts });
    assert.equal(t.itemsTotal, 100);
    assert.equal(t.total, 100);
    assert.equal(t.tax, 0);
  });

  it("taxes only the kinds of line the job taxes", () => {
    const t = computeJobTotals({
      ...none,
      taxRatePercent: "8.25",
      taxProducts: true,
      jobServices: labor,
      jobProducts: parts,
    });
    assert.equal(t.taxableAmount, 40);
    assert.equal(t.tax, 3.3);
    assert.equal(t.total, 103.3);
  });

  it("spreads a discount over taxed and untaxed lines before tax", () => {
    const t = computeJobTotals({
      ...none,
      taxRatePercent: 10,
      taxProducts: true,
      discountType: "AMOUNT",
      discountValue: "10.00",
      jobServices: labor,
      jobProducts: parts,
    });
    // $10 off a $100 bill: $4 of it comes off the $40 of taxed parts.
    assert.equal(t.discount, 10);
    assert.equal(t.taxableAmount, 36);
    assert.equal(t.tax, 3.6);
    assert.equal(t.total, 93.6);
  });

  it("percent discounts, and caps that keep the bill from going negative", () => {
    const pct = computeJobTotals({ ...none, discountType: "PERCENT", discountValue: 15, jobServices: labor, jobProducts: parts });
    assert.equal(pct.discount, 15);
    assert.equal(pct.total, 85);
    const huge = computeJobTotals({ ...none, discountType: "AMOUNT", discountValue: 500, jobServices: labor });
    assert.equal(huge.discount, 60);
    assert.equal(huge.total, 0);
    const over = computeJobTotals({ ...none, discountType: "PERCENT", discountValue: 250, jobServices: labor });
    assert.equal(over.total, 0);
  });

  it("an exempt job pays no tax whatever its rate", () => {
    const t = computeJobTotals({
      ...none,
      taxRatePercent: 9,
      taxServices: true,
      taxProducts: true,
      taxExempt: true,
      jobServices: labor,
      jobProducts: parts,
    });
    assert.equal(t.tax, 0);
    assert.equal(t.total, 100);
  });

  it("rounds tax to the cent", () => {
    const t = computeJobTotals({
      ...none,
      taxRatePercent: "7.375",
      taxServices: true,
      jobServices: [{ quantity: 3, unitPrice: "19.99" }],
    });
    assert.equal(t.itemsTotal, 59.97);
    assert.equal(t.tax, 4.42);
    assert.equal(t.total, 64.39);
  });
});
