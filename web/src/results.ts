import {
  CONCERNS,
  type DecideFn,
  type Observation,
  type PurposeTag,
  type Goal,
} from "../../contracts";
import { decide } from "../../shared/decide";
import { PRODUCT_CARDS } from "../../shared/products";
export const sourceLabel = {
  live: "Live",
  sample: "Sample (pre-analyzed)",
  mock: "Mock",
};
export function renderResults(
  root: HTMLElement,
  observations: Observation[],
  decideFn: DecideFn = decide,
) {
  if (observations.some((o) => o.source === "sample")) {
    root.innerHTML =
      '<div class="sample-silhouette" role="img" aria-label="Placeholder silhouette, not a real face"><span></span></div>';
  } else {
    root.replaceChildren();
  }
  const goal: Goal = { concern: "moisture", reportedSevereSymptom: false };
  const owned = new Set<PurposeTag>();
  root.insertAdjacentHTML(
    "beforeend",
    "<h2>Your observations</h2><p>Provider numbers, unchanged. Score direction is unconfirmed; these are not severity labels.</p>",
  );
  for (const o of observations) {
    const p = document.createElement("p");
    p.className = "score";
    p.textContent = `${o.concern}: ${o.rawScore} `;
    const badge = document.createElement("span");
    badge.className = "source-badge";
    badge.textContent = sourceLabel[o.source];
    p.append(badge);
    root.append(p);
  }
  const label = document.createElement("label");
  label.textContent = "What would you like to focus on?";
  const select = document.createElement("select");
  for (const c of CONCERNS) {
    const option = document.createElement("option");
    option.value = c;
    option.textContent = c;
    select.append(option);
  }
  label.append(select);
  root.append(label);
  const field = document.createElement("fieldset");
  field.innerHTML = "<legend>Already own a product for…</legend>";
  for (const c of CONCERNS) {
    const l = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", `Already own ${c}`);
    input.onchange = () => {
      input.checked ? owned.add(c) : owned.delete(c);
      update();
    };
    l.append(input, document.createTextNode(c));
    field.append(l);
  }
  root.append(field);
  const sl = document.createElement("label");
  const severe = document.createElement("input");
  severe.type = "checkbox";
  severe.onchange = () => {
    goal.reportedSevereSymptom = severe.checked;
    update();
  };
  sl.append(
    severe,
    document.createTextNode(
      "I have severe or painful symptoms (self-reported).",
    ),
  );
  root.append(sl);
  const cards = document.createElement("div");
  cards.className = "products";
  for (const product of PRODUCT_CARDS) {
    const article = document.createElement("article");
    const h = document.createElement("h3");
    h.textContent = product.name;
    const p = document.createElement("p");
    p.textContent = product.description;
    article.append(h, p);
    cards.append(article);
  }
  root.append(cards);
  const decision = document.createElement("section");
  decision.className = "decision";
  decision.setAttribute("aria-live", "polite");
  root.append(decision);
  const titles = {
    use_existing_first: "Use your existing product first",
    consider_category: "Consider this category",
    insufficient_evidence_retake: "Insufficient evidence — retake",
    see_dermatologist: "See a dermatologist",
  };
  function update() {
    const result = decideFn(observations, goal, [...owned]);
    decision.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = titles[result.action];
    const next = document.createElement("p");
    next.textContent = result.nextStep;
    decision.append(h, next);
    if (result.productCardId) {
      const p = document.createElement("p");
      p.textContent =
        PRODUCT_CARDS.find((c) => c.id === result.productCardId)?.name ?? "";
      decision.append(p);
    }
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Why this action? Evidence and limits";
    details.append(summary);
    for (const reason of result.reasons) {
      const p = document.createElement("p");
      p.textContent = reason.text;
      details.append(p);
      for (const o of reason.evidence) {
        const e = document.createElement("p");
        e.textContent = `${o.concern}: ${o.rawScore} · ${sourceLabel[o.source]}`;
        details.append(e);
      }
    }
    decision.append(details);
  }
  select.onchange = () => {
    goal.concern = select.value as Goal["concern"];
    update();
  };
  update();
}
