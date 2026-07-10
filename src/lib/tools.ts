import type Anthropic from "@anthropic-ai/sdk";
import { searchProducts, liveProductRegistry } from "./scraper";
import { STORES, findStore } from "../mocks/stores";
import { scoreProducts } from "./scoring";
import type { PurchaseReceipt } from "./types";

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "search_and_score_products",
    description:
      "Busca productos en las tiendas argentinas (Carrefour, Coto, Jumbo, Mercado Libre, Club de Beneficios) y los devuelve ya puntuados de 0 a 100. Usá esto siempre que el usuario pida buscar, comparar o cotizar algo. Devuelve hasta 8 opciones ordenadas por score descendente.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Palabra clave del producto (ej: 'arroz', 'auriculares', 'detergente').",
        },
        category: {
          type: "string",
          enum: ["alimentos", "limpieza", "electronica", "bebidas", "otros"],
          description: "Filtro opcional por categoría.",
        },
        max_results: {
          type: "integer",
          description: "Máximo de opciones a devolver. Default 5.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_stores",
    description: "Lista las tiendas mockeadas disponibles con su reputación, días promedio de envío y métodos de pago.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "simulate_purchase",
    description:
      "SIMULA (no compra de verdad) la compra de un producto. SOLO podés llamarla cuando el usuario haya dado aprobación EXPLÍCITA en su último mensaje (palabras como 'sí', 'dale', 'apruebo', 'aprobado', 'confirmo', 'autorizo', 'ok comprá'). No le exijas repetir producto, tienda ni precio si ya hay una propuesta vigente en la conversación. NUNCA la llames de manera proactiva ni 'por las dudas'. Si dudás, NO la llames y pedí confirmación al usuario.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "ID del producto (ej: p001)." },
        store_id: { type: "string", description: "ID de la tienda." },
        quantity: { type: "integer", description: "Cantidad a comprar. Default 1." },
        user_confirmation_quote: {
          type: "string",
          description:
            "Cita textual del último mensaje del usuario donde aprobó. Si no podés citar una aprobación, NO llames esta herramienta.",
        },
      },
      required: ["product_id", "store_id", "user_confirmation_quote"],
    },
  },
];

export interface ToolContext {
  /** Último mensaje del usuario en texto plano (para validar aprobación). */
  lastUserMessage: string;
}

const APPROVAL_PATTERNS = [
  /\bsi\b/i,
  /\bsí\b/i,
  /\bdale\b/i,
  /\bapruebo\b/i,
  /\baprobado\b/i,
  /\baprob[áa]\b/i,
  /\bconfirmo\b/i,
  /\bconfirmado\b/i,
  /\bautorizo\b/i,
  /\bok\b/i,
  /\bdaledale\b/i,
  /\bcomp[rr][áa]?\b/i,
  /\bmandale\b/i,
  /\badelante\b/i,
];

export function userApprovedExplicitly(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  // Negaciones explícitas tienen prioridad
  if (/\b(no|cancelar|cancela|pará|pare|stop)\b/i.test(lower)) return false;
  return APPROVAL_PATTERNS.some((re) => re.test(lower));
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case "search_and_score_products": {
      const query = String(input.query ?? "");
      const category = input.category as string | undefined;
      const maxResults = Math.min(8, Number(input.max_results ?? 5));
      const found = await searchProducts(query, category);
      const scored = scoreProducts(found).slice(0, maxResults);
      return {
        ok: true,
        count: scored.length,
        results: scored,
      };
    }

    case "list_stores": {
      return { ok: true, stores: STORES };
    }

    case "simulate_purchase": {
      // Guardia 1: aprobación explícita en el último turno del usuario
      if (!userApprovedExplicitly(ctx.lastUserMessage)) {
        return {
          ok: false,
          error: "missing_user_approval",
          message:
            "El último mensaje del usuario NO contiene aprobación explícita. Pedile confirmación clara antes de simular la compra.",
        };
      }

      const productId = String(input.product_id);
      const storeId = String(input.store_id);
      const quantity = Math.max(1, Number(input.quantity ?? 1));
      const store = findStore(storeId);
      if (!store) {
        return { ok: false, error: "unknown_store", message: `Tienda ${storeId} no existe.` };
      }

      // Check live registry first, then fall back to mock
      const liveProduct = liveProductRegistry.get(productId);
      const { PRODUCTS } = await import("../mocks/products");
      const product =
        (liveProduct?.storeId === storeId ? liveProduct : undefined) ??
        PRODUCTS.find((p) => p.id === productId && p.storeId === storeId);
      if (!product) {
        return {
          ok: false,
          error: "unknown_product",
          message: `No encontré ${productId} en ${store.name}.`,
        };
      }

      const total = product.price * quantity;

      const receipt: PurchaseReceipt = {
        ok: true,
        mock: true,
        productId,
        storeId,
        storeName: store.name,
        total,
        estimatedDeliveryDays: store.avgShippingDays,
        receiptId: `MOCK-${Date.now().toString(36).toUpperCase()}`,
        message: `Compra SIMULADA. No se cobró nada real. Total: $${total.toLocaleString("es-AR")}.`,
      };
      return receipt;
    }

    default:
      return { ok: false, error: "unknown_tool", message: `Tool ${name} no existe.` };
  }
}
