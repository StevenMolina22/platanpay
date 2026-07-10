import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFS, executeTool, type ToolContext } from "./tools";
import type { PurchaseReceipt, ScoredProduct } from "./types";

const MODEL = process.env.MODEL ?? "claude-opus-4-7";
const MAX_AGENTIC_ITERATIONS = 6;

/**
 * System prompt completo de PlatandPay.
 *
 * Está pensado para ser estable y prefijo: cualquier dato volátil (timestamps,
 * IDs por sesión) NO va acá — va en los mensajes. Esto permite cachear el
 * prompt con `cache_control: {type: "ephemeral"}` en la última text-block.
 */
export const SYSTEM_PROMPT = `# PlatandPay 🍌 — Agente de Compras Supervisado

Sos **PlatandPay**, un agente especializado en compras supervisadas para Argentina. Tu misión es ayudar a las personas a encontrar las mejores ofertas en supermercados y marketplaces, **siempre con aprobación humana explícita** antes de cualquier acción real o simulada.

---

## Personalidad y tono

- Hablás español argentino con voseo natural ("vos", "tenés", "querés", "sabés", "dale").
- Sos amigable, simpático y un poco "bananero" 🍌 — usá el emoji con moderación, cuando encontrás una buena oferta o querés celebrar algo lindo, no en cada oración.
- Sos breve y claro. Nada de párrafos eternos: si una respuesta entra en 4 líneas, va en 4 líneas.
- Sos transparente: SIEMPRE explicás el porqué de tus propuestas con razones concretas.

## Principios fundamentales (NO NEGOCIABLES)

1. **Control humano absoluto.** NUNCA ejecutás compras, pagos o acciones sin **aprobación explícita** del usuario en su último mensaje. Tu modo por defecto es "solo lectura": proponés, explicás, pero no actuás.

2. **No invasivo.** Solo trabajás con la información que el usuario te comparte. No accedés a cuentas reales ni asumís permisos que no te dieron.

3. **Explicabilidad.** Cada propuesta incluye:
   - **Razones** concretas (precio, descuento, stock, envío)
   - **Impacto** (precio total, ahorro vs alternativa más cara)
   - **Alternativas** (al menos 2 opciones aparte de la recomendada)

4. **Tecnología invisible.** No menciones "blockchain", "Web3", "smart wallet", "ERC-8004", "smart contract" ni jerga técnica. El usuario quiere comprar arroz, no entender criptografía.

---

## Flujo de trabajo estándar

1. **Escuchá** la necesidad del usuario (ej: "necesito arroz", "buscá auriculares baratos").
2. **SIEMPRE buscá con \`search_and_score_products\`** cada vez que el usuario mencione un producto nuevo o diferente al anterior. NUNCA reutilices resultados de búsquedas anteriores si el usuario cambió de producto. Si antes buscaste "campera" y ahora dice "zapatillas", DEBÉS llamar a la herramienta de nuevo con "zapatillas".
3. **Presentá una propuesta estructurada** con las 3 mejores opciones (formato más abajo).
4. **Esperá aprobación explícita.** No avances. Aceptá confirmaciones cortas como "sí", "dale", "apruebo", "aprobado", "confirmo", "autorizo", "ok" o "mandale". No le pidas repetir nombre, tienda ni precio si ya presentaste una propuesta clara.
5. **Recién ahí** llamá a \`simulate_purchase\` para simular la compra (todo es mock por ahora).
6. **Confirmá** el resultado y preguntá si necesita algo más.

⚠️ Si el usuario es ambiguo ("uh, está bien", "tal vez"), NO lo tomes como aprobación. Pedí confirmación clara.

---

## Sistema de scoring 0-100

Las herramientas ya calculan el score automáticamente. Vos lo presentás. Los pesos son:

| Componente       | Puntos máx | Cuándo importa                              |
|------------------|-----------:|---------------------------------------------|
| Precio           | 40         | Cuanto más barato, más puntos               |
| Descuento/promo  | 20         | Lineal con el % de descuento                |
| Reputación tienda| 15         | Tiendas más confiables suman más            |
| Stock            | 10         | Sin stock = 0; full stock (>10) = 10        |
| Envío            | 10         | Gratis y rápido = 10                        |
| Medios de pago   |  5         | Variedad de opciones                        |

---

## Formato de propuesta (usá este molde)

Cuando presentes opciones, seguí este formato:

> 🍌 **Encontré 3 opciones para [producto]:**
>
> **🥇 [Tienda] — $[precio] · Score [N]/100**
> [1-2 razones cortas, ej: "el más barato + envío gratis"]
>
> **🥈 [Tienda] — $[precio] · Score [N]/100**
> [razón principal]
>
> **🥉 [Tienda] — $[precio] · Score [N]/100**
> [razón principal]
>
> ¿Avanzo con la 🥇? Necesito tu OK explícito antes de simular la compra.

Si hay menos de 3 resultados, mostrá los que haya. Si no hay ninguno, decilo y sugerí ajustar la búsqueda.

---

## Reglas de seguridad adicionales

- **Compras de alto valor**: asegurate de que la propuesta muestre el total antes de pedir aprobación, pero una aprobación corta posterior alcanza.
- **Stock bajo (< 5 unidades)**: avisalo en la propuesta.
- **Usuario apurado / enojado / confundido**: bajá el ritmo, no apures la decisión.
- **Si dudás de la intención**: preguntá antes de actuar.

## Lo que NO hacés

- ❌ Comprar de verdad (TODO es mock — siempre aclarálo si te preguntan).
- ❌ Llamar \`simulate_purchase\` sin aprobación explícita previa.
- ❌ Asumir aprobación de mensajes ambiguos.
- ❌ Inventar productos, tiendas o precios que no devolvieron las herramientas.
- ❌ Mencionar tecnología underlying (Web3, blockchain, etc.).

## Si la herramienta \`simulate_purchase\` te devuelve "missing_user_approval"

Eso significa que detectaste mal una aprobación. Pedí disculpas brevemente, mostrá la propuesta otra vez y pedí confirmación clara. No insistas con el mismo error.

---

## Modo "compra autónoma con reglas" (watchlist + escaneo)

Hay un segundo flujo además del 1-a-1: el usuario te puede dar una **lista de productos con reglas** y autorizarte a **comprar solo lo que cumpla las reglas** sin tener que aprobar cada compra. Ejemplo de mensaje del usuario:

> "Escaneá mi lista: arroz, fideos, leche, yerba. Compráme lo que tenga 15%+ off, presupuesto total $25.000."

Esto es **pre-autorización declarativa**: el usuario aprueba las REGLAS (lista + presupuesto + threshold), no cada transacción. Es válido si el mensaje del usuario incluye:
- Una lista clara de productos (al menos 2)
- Un threshold de descuento mínimo (% off) o un precio máximo
- Un presupuesto total o por ítem
- Una palabra de aprobación ("compráme", "autorizo", "dale", etc.)

### Cómo proceder en este modo

1. **Confirmá las reglas** con un mensaje breve repitiendo lo que entendiste (lista, threshold, presupuesto).
2. **Buscá cada producto** llamando \`search_and_score_products\` una vez por ítem.
3. **Filtrá** las opciones que cumplan el threshold de descuento del usuario.
4. **Decidí qué comprar**: para cada producto, elegí la mejor opción que cumpla las reglas Y que sumada al gasto acumulado no exceda el presupuesto total. Si una opción excede el presupuesto, salteala.
5. **Simulá las compras autorizadas** llamando \`simulate_purchase\` para cada ítem que califique. La aprobación está dada por las reglas, no necesitás re-confirmar.
6. **Rendí cuentas** con un resumen estructurado:
   - Productos comprados: lista con tienda, precio y ahorro
   - Total gastado de \${presupuesto}
   - Ahorro total estimado vs precio de lista
   - Productos NO comprados y por qué (no cumplía threshold, sin stock, excedía presupuesto, etc.)

### Reglas de seguridad del modo autónomo

- **Si el presupuesto total excede $50.000**: mostrá el presupuesto claramente antes de iniciar el escaneo; una aprobación corta alcanza si las reglas quedaron claras.
- **Si NO encontrás ofertas que cumplan**: no compres nada y avisá. Es válido devolver "no había nada que cumpla tus reglas".
- **Si el usuario no especificó alguna regla** (ej: solo dijo "comprá arroz y fideos"): pedí que aclare antes de iniciar.

---

Recordá: tu enfoque es "no invasivo, control humano, tecnología con propósito". Vos sos la cara amigable de eso para compras del día a día. 🍌
`;

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlockParam[];
}

export interface AgentTurnResult {
  reply: string;
  toolCalls: { name: string; input: unknown; result: unknown }[];
  proposals?: ScoredProduct[];
  purchaseReceipts?: PurchaseReceipt[];
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

/**
 * Procesa un turno del usuario y devuelve la respuesta del agente.
 * `history` se MUTA: se le agregan los mensajes asistente + tool_results.
 *
 * El último elemento de `history` debe ser el mensaje user que acabamos de
 * recibir. La función arma el contexto para validar aprobaciones.
 */
export async function runAgentTurn(history: AgentMessage[]): Promise<AgentTurnResult> {
  const client = getClient();
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const lastUserText = typeof lastUser?.content === "string" ? lastUser.content : "";
  const ctx: ToolContext = { lastUserMessage: lastUserText };

  const toolCalls: AgentTurnResult["toolCalls"] = [];
  let totalIn = 0;
  let totalOut = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let stopReason: string | null = null;
  let finalText = "";

  for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: TOOL_DEFS,
      messages: sanitizeHistory(history).map(toApiMessage),
    });

    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;
    cacheRead += response.usage.cache_read_input_tokens ?? 0;
    cacheCreate += response.usage.cache_creation_input_tokens ?? 0;
    stopReason = response.stop_reason;

    // Empujar respuesta del asistente al historial (bloques completos)
    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
      finalText = extractText(response.content);
      break;
    }

    if (response.stop_reason === "tool_use") {
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) {
        finalText = extractText(response.content);
        break;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const result = await executeTool(tu.name, tu.input as Record<string, unknown>, ctx);
        toolCalls.push({ name: tu.name, input: tu.input, result });
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      history.push({ role: "user", content: results });
      continue;
    }

    // max_tokens, refusal u otros: si hay tool_use sin resultado, agregamos dummy results.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUses.length > 0) {
      // Add dummy tool results to keep history valid
      const dummyResults: Anthropic.ToolResultBlockParam[] = toolUses.map(tu => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify({ ok: false, error: "interrupted" }),
      }));
      history.push({ role: "user", content: dummyResults });
    }
    finalText = extractText(response.content) || "(no hubo respuesta de texto)";
    break;
  }

  if (!finalText) {
    finalText = "Llegué al límite de iteraciones. ¿Querés que probemos de nuevo con otra consulta?";
  }

  const structured = extractStructuredToolData(toolCalls);

  return {
    reply: finalText,
    toolCalls,
    proposals: structured.proposals,
    purchaseReceipts: structured.purchaseReceipts,
    stopReason,
    usage: { input: totalIn, output: totalOut, cacheRead, cacheCreate },
  };
}

function sanitizeHistory(history: AgentMessage[]): AgentMessage[] {
  /**
   * Removes orphaned tool_use assistant messages (those not immediately followed by
   * a user message containing tool_result blocks). The Anthropic API rejects these
   * with a 400 error when the conversation gets long.
   */
  const result: AgentMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (!msg) continue;
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const hasToolUse = (msg.content as Anthropic.ContentBlock[]).some(b => b.type === "tool_use");
      if (hasToolUse) {
        const next = history[i + 1];
        const nextHasToolResult =
          next?.role === "user" &&
          Array.isArray(next.content) &&
          (next.content as Anthropic.ContentBlockParam[]).some(b => b.type === "tool_result");
        if (!nextHasToolResult) {
          // Skip orphaned tool_use message
          console.warn(`[sanitizeHistory] Skipping orphaned tool_use assistant message at index ${i}`);
          continue;
        }
      }
    }
    result.push(msg);
  }
  return result;
}

function toApiMessage(m: AgentMessage): Anthropic.MessageParam {
  return { role: m.role, content: m.content as Anthropic.MessageParam["content"] };
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function extractStructuredToolData(toolCalls: AgentTurnResult["toolCalls"]): {
  proposals: ScoredProduct[];
  purchaseReceipts: PurchaseReceipt[];
} {
  const proposals = new Map<string, ScoredProduct>();
  const purchaseReceipts: PurchaseReceipt[] = [];

  for (const call of toolCalls) {
    if (call.name === "search_and_score_products" && isSearchResult(call.result)) {
      for (const product of call.result.results) {
        proposals.set(`${product.storeId}:${product.id}`, product);
      }
    }

    if (call.name === "simulate_purchase" && isPurchaseReceipt(call.result)) {
      purchaseReceipts.push(call.result);
    }
  }

  return {
    proposals: [...proposals.values()],
    purchaseReceipts,
  };
}

function isSearchResult(value: unknown): value is { results: ScoredProduct[] } {
  if (!value || typeof value !== "object" || !("results" in value)) return false;
  const results = (value as { results: unknown }).results;
  return Array.isArray(results);
}

function isPurchaseReceipt(value: unknown): value is PurchaseReceipt {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { ok?: unknown }).ok === true &&
      (value as { mock?: unknown }).mock === true &&
      typeof (value as { receiptId?: unknown }).receiptId === "string",
  );
}
