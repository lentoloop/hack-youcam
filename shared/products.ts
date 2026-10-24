/** Three generic product cards (no brands). OWNED BY S1; S2 reads only. */
import type { ProductCard } from "../contracts";

export const PRODUCT_CARDS: readonly ProductCard[] = [
  { id: "gel-moisturizer", name: "Gel Moisturizer", category: "moisturizer", purposeTags: ["texture"], description: "Lightweight hydrating gel." },
  { id: "oil-control-toner", name: "Oil-Control Toner", category: "toner", purposeTags: ["acne", "texture"], description: "Balancing toner for shine and uneven texture." },
  { id: "soothing-serum", name: "Soothing Serum", category: "serum", purposeTags: ["redness"], description: "Calming serum for the look of redness." },
];
