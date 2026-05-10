import type { Offer } from "@/lib/platanpay-state";

// Real Unsplash CDN photo IDs (verified from photo pages)
const KEYWORD_PHOTOS: { keywords: string[]; cdnId: string }[] = [
  { keywords: ["auricular", "headphone", "jbl", "sony", "bluetooth"], cdnId: "photo-1505740420928-5e560c06d30e" },
  { keywords: ["zapatilla", "adidas", "nike", "calzado", "sneaker", "running"], cdnId: "photo-1553835584-c3eab150319e" },
  { keywords: ["yerba", "mate"], cdnId: "photo-1753954559759-480c89ba99d6" },
  { keywords: ["coca", "cola", "gaseosa", "refresco", "pepsi", "bebida"], cdnId: "photo-1554866585-cd94860890b7" },
  { keywords: ["arroz", "rice"], cdnId: "photo-1584208632869-05fa2b2a5934" },
  { keywords: ["aceite", "oil", "oliva"], cdnId: "photo-1674532090540-6206a6e2f68b" },
  { keywords: ["detergente", "limpieza", "magistral", "jabón", "jabon", "cleaning"], cdnId: "photo-1677702440030-f7df8b2b00ca" },
  { keywords: ["leche", "milk", "serenisima", "lacteo"], cdnId: "photo-1601436423474-51738541c1b1" },
  { keywords: ["fideo", "pasta", "spaghetti", "matarazzo"], cdnId: "photo-1497802492746-aa584aa6ea22" },
  { keywords: ["galletita", "oreo", "cookie", "biscuit", "galleta"], cdnId: "photo-1565958076205-896314b3cf38" },
];

const CATEGORY_EMOJI: Record<string, string> = {
  alimentos: "🛒",
  electronica: "📦",
  limpieza: "🧴",
  bebidas: "🥤",
  otros: "📦",
};

function unsplashUrl(cdnId: string) {
  return `https://images.unsplash.com/${cdnId}?auto=format&fit=crop&w=200&h=200&q=80`;
}

export function getOfferImageSource(offer: Offer): string | undefined {
  if (offer.imageUrl?.startsWith("https://")) return offer.imageUrl;

  const text = `${offer.product} ${offer.category}`.toLowerCase();
  for (const { keywords, cdnId } of KEYWORD_PHOTOS) {
    if (keywords.some((kw) => text.includes(kw))) return unsplashUrl(cdnId);
  }

  return undefined;
}

export function getOfferEmoji(offer: Offer): string {
  const text = `${offer.product} ${offer.category}`.toLowerCase();

  if (text.includes("auricular") || text.includes("headphone") || text.includes("bluetooth")) return "🎧";
  if (text.includes("zapatilla") || text.includes("calzado") || text.includes("sneaker")) return "👟";
  if (text.includes("yerba") || text.includes("mate")) return "🧉";
  if (text.includes("coca") || text.includes("gaseosa") || text.includes("bebida")) return "🥤";
  if (text.includes("arroz") || text.includes("rice")) return "🍚";
  if (text.includes("aceite") || text.includes("oil") || text.includes("oliva")) return "🫒";
  if (text.includes("detergente") || text.includes("limpieza") || text.includes("jabón")) return "🧴";
  if (text.includes("leche") || text.includes("milk") || text.includes("lacteo")) return "🥛";
  if (text.includes("fideo") || text.includes("pasta") || text.includes("spaghetti")) return "🍝";
  if (text.includes("galletita") || text.includes("oreo") || text.includes("cookie")) return "🍪";
  if (text.includes("atun") || text.includes("tuna") || text.includes("lata")) return "🐟";
  if (text.includes("cafe") || text.includes("café")) return "☕";
  if (text.includes("campera") || text.includes("ropa") || text.includes("remera")) return "👕";
  if (text.includes("banana") || text.includes("fruta") || text.includes("manzana")) return "🍎";
  if (text.includes("papa") || text.includes("verdura") || text.includes("tomate")) return "🥦";
  if (text.includes("pan") || text.includes("bread")) return "🍞";
  if (text.includes("yogur") || text.includes("queso")) return "🧀";

  const cat = offer.category?.toLowerCase();
  return CATEGORY_EMOJI[cat] ?? "🛍️";
}
