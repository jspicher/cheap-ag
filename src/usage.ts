export type CostSource = "reported" | "configured" | "unknown" | "mixed";
export type Cost = { costUsd: number; costSource?: CostSource; costIncomplete?: boolean };

export function sumCosts(values: Cost[]): Cost {
  const sources = new Set(values.map(v => v.costSource));
  const incomplete = values.some(v => v.costIncomplete || v.costSource === "unknown");
  return { costUsd: values.reduce((n, v) => n + v.costUsd, 0),
    costSource: sources.size > 1 ? "mixed" : values[0]?.costSource,
    ...(incomplete && { costIncomplete: true }) };
}
export function renderCost(value: Cost): string {
  if (value.costSource === "unknown" && !value.costUsd) return "cost=unknown";
  return `cost=$${value.costUsd.toFixed(3)}${value.costSource === "configured" ? "(estimate)" : value.costIncomplete ? "(known-subtotal,incomplete)" : value.costSource === "mixed" ? "(mixed)" : ""}`;
}

/** Local configured pricing is an estimate, not an engine-reported bill. */
export function messageCost(provider: string, amount: unknown, input: number, output: number, price?: { input: number; output: number }, knownPricing = false): Cost {
  if (provider === "local" && price) return { costUsd: (input * price.input + output * price.output) / 1e6, costSource: "configured" };
  if (provider !== "codex" && typeof amount === "number" && Number.isFinite(amount) && (amount > 0 || (amount === 0 && knownPricing && provider !== "local"))) return { costUsd: amount, costSource: "reported" };
  return { costUsd: 0, costSource: "unknown", costIncomplete: true };
}
