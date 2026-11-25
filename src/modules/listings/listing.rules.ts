// "What we'd do next": rule-based suggestions from a listing's own numbers. Plain code, no AI.
// Copied from the old Hub (convex/suggestions.ts computeRules), unchanged.

export type Rule = { ruleKey: string; title: string; why: string; action: string };

// Benchmarks (tunable): 1 showing per 150 Zillow views; 3% saves-to-views.
export const VIEWS_PER_SHOWING = 150;
export const SAVE_RATE = 0.03;

const THEMES: { key: string; label: string; re: RegExp; action: string }[] = [
  { key: "price", label: "price", re: /\b(price|priced|pricey|overpriced|expensive|too high|value|cost)\b/i, action: "Review price against the latest comps, or offer a buyer credit." },
  { key: "size", label: "size or layout", re: /\b(small|size|tight|cramped|layout|bedroom|closet|storage|square f|sq ?ft)\b/i, action: "Add a floor plan with room sizes and photos that show scale." },
  { key: "condition", label: "condition", re: /\b(condition|dated|update|updates|repair|repairs|worn|old|smell|odor|damage|carpet|kitchen needs|bath needs)\b/i, action: "Fix or disclose what buyers mention; consider a pre-inspection report." },
];

/** Days on market from the YYYY-MM-DD live date (Chicago noon), or null. */
export function daysOn(live?: string | null): number | null {
  if (!live) return null;
  const d = Math.floor((Date.now() - new Date(`${live}T12:00:00-05:00`).getTime()) / 864e5);
  return d >= 0 ? d : null;
}

export type RuleInput = {
  views: number;
  saves: number;
  showings: number;
  offers: number;
  dom: number | null;
  openHouseDone: boolean;
  openHouseVisitors: number;
  feedback: { text: string; priceOpinion?: string | null }[];
};

export function computeRules(x: RuleInput): Rule[] {
  const out: Rule[] = [];
  const n = (k: number) => k.toLocaleString("en-US");
  if (x.views >= 300 && x.views / Math.max(1, x.showings) > VIEWS_PER_SHOWING) {
    const per = x.showings ? `about 1 showing per ${n(Math.round(x.views / x.showings))} views` : "no showings yet";
    out.push({ ruleKey: "views_showings", title: "Turn online views into showings", why: `${n(x.views)} Zillow views but ${x.showings} showing${x.showings === 1 ? "" : "s"}: ${per}. Healthy is 1 per ${VIEWS_PER_SHOWING} or better.`, action: "Hold an open house, test a new cover photo, and check price against the newest comps." });
  }
  if (x.views >= 200 && x.saves / x.views < SAVE_RATE) {
    out.push({ ruleKey: "save_rate", title: "Refresh the lead photo", why: `${n(x.saves)} saves from ${n(x.views)} views (${((x.saves / x.views) * 100).toFixed(1)}%). Strong listings get ${SAVE_RATE * 100}% or more.`, action: "Swap the first photo for the strongest exterior or living-room shot and re-order the gallery." });
  }
  if (x.dom !== null && x.dom >= 14 && x.offers === 0) {
    out.push({ ruleKey: "day14_pricing", title: "Pricing review against new comps", why: `${x.dom} days on market and no offers yet.`, action: "Day-14 checkpoint: compare price to homes listed or sold nearby in the last 30 days, then adjust or hold." });
  }
  if (x.dom !== null && x.dom >= 3 && x.dom <= 21 && !x.openHouseDone && x.openHouseVisitors === 0) {
    out.push({ ruleKey: "open_house", title: "Schedule an open house", why: `${x.dom} day${x.dom === 1 ? "" : "s"} live with no open house yet. The first 10 days bring the most buyer traffic.`, action: "Book an open house for this weekend and send it to our buyer list." });
  }
  if (x.feedback.length) {
    for (const t of THEMES) {
      const hits = x.feedback.filter(f => t.re.test(f.text) || (t.key === "price" && /high|over/i.test(f.priceOpinion ?? ""))).length;
      if (hits >= 2) out.push({ ruleKey: `feedback_${t.key}`, title: `Address ${t.label} feedback`, why: `${hits} of ${x.feedback.length} buyer feedback notes mention ${t.label}.`, action: t.action });
    }
  }
  return out;
}
