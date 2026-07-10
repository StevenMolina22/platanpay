import { runAgentTurn, type AgentMessage, type AgentTurnResult } from "@/lib/agent";
import { PRODUCTS, searchProducts } from "@/mocks/products";
import { scoreProducts } from "@/lib/scoring";
import { countSessions, deleteSession, getSessionMessages, saveSessionMessages } from "@/db/sessions";
import type { ScoredProduct } from "@/lib/types";

export async function getHealth() {
  return { ok: true, agent: "PlatandPay 🍌", sessions: await countSessions() };
}

export async function handleChat(input: unknown) {
  const { sessionId, message } = (input ?? {}) as { sessionId?: unknown; message?: unknown };
  if (
    typeof sessionId !== "string" ||
    typeof message !== "string" ||
    sessionId.trim() === "" ||
    message.trim() === ""
  ) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "bad_request",
        message: "Mandá { sessionId: string, message: string } no vacíos en el body.",
      },
    };
  }

  const history = await getSessionMessages(sessionId);
  history.push({ role: "user", content: message });

  try {
    const result = await runConfiguredAgentTurn(history);
    // When the agent reuses cached results (no tool call this turn) and made no purchase,
    // surface the most recent search results from history so the frontend panel stays in sync.
    if (!result.proposals?.length && !result.purchaseReceipts?.length) {
      const cached = extractLatestSearchResultsFromHistory(history);
      if (cached.length) result.proposals = cached;
    }
    await saveSessionMessages(sessionId, history);
    return { status: 200, body: serializeAgentResult(result) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isHistoryCorruption =
      (msg.includes("tool_use") && msg.includes("tool_result") && msg.includes("400")) ||
      msg.includes("invalid_request_error");

    if (isHistoryCorruption) {
      console.warn(`[server] History corruption detected for session ${sessionId}, resetting and retrying...`);
      const freshHistory: AgentMessage[] = [{ role: "user", content: message }];
      await saveSessionMessages(sessionId, freshHistory);
      try {
        const retryResult = await runConfiguredAgentTurn(freshHistory);
        await saveSessionMessages(sessionId, freshHistory);
        return { status: 200, body: serializeAgentResult(retryResult) };
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        return { status: 500, body: { ok: false, error: "agent_failure", message: retryMsg } };
      }
    }

    return { status: 500, body: { ok: false, error: "agent_failure", message: msg } };
  }
}

export async function resetSession(id: string) {
  await deleteSession(id);
  return { ok: true, message: "Sesión reseteada." };
}

function serializeAgentResult(result: AgentTurnResult) {
  return {
    ok: true,
    reply: result.reply,
    toolCalls: result.toolCalls,
    proposals: result.proposals ?? [],
    purchaseReceipts: result.purchaseReceipts ?? [],
    usage: result.usage,
    stopReason: result.stopReason,
  };
}

async function runConfiguredAgentTurn(history: AgentMessage[]): Promise<AgentTurnResult> {
  if (process.env.PLATANDPAY_AGENT_MOCK !== "1") {
    return runAgentTurn(history);
  }

  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const lastUserText = typeof lastUser?.content === "string" ? lastUser.content : "";
  const proposals = scoreProducts(searchProducts(inferMockProductQuery(lastUserText))).slice(0, 10);
  const approved = /\b(si|sí|dale|apruebo|aprobado|confirmo|autorizo|ok|mandale)\b/i.test(lastUserText);
  const purchaseReceipts =
    approved && proposals[0]
      ? [
          {
            ok: true,
            mock: true as const,
            productId: proposals[0].id,
            storeId: proposals[0].storeId,
            storeName: proposals[0].storeName,
            total: proposals[0].price,
            estimatedDeliveryDays: 2,
            receiptId: `MOCK-${Date.now().toString(36).toUpperCase()}`,
            message: `Compra SIMULADA. No se cobró nada real. Total: $${proposals[0].price.toLocaleString("es-AR")}.`,
          },
        ]
      : [];
  const reply =
    proposals.length > 0
      ? `Encontré ${proposals.length} opciones para "${inferMockProductQuery(lastUserText)}". Revisalas abajo y aprobá una si querés que simule la compra.`
      : `Respuesta mock para: ${lastUserText}`;
  history.push({ role: "assistant", content: reply });

  return {
    reply,
    toolCalls: [],
    proposals,
    purchaseReceipts,
    stopReason: "end_turn",
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
  };
}

function inferMockProductQuery(text: string): string {
  const normalized = text.toLowerCase();
  const tags = new Set(PRODUCTS.flatMap((product) => product.tags));
  const matched = [...tags].find((tag) => normalized.includes(tag));
  return matched ?? normalized.split(/\s+/).find((part) => part.length > 3) ?? normalized;
}

/**
 * Scans conversation history backwards to find the most recent
 * search_and_score_products tool result, so the frontend panel stays
 * in sync when the agent reuses cached results without re-calling the tool.
 */
function extractLatestSearchResultsFromHistory(history: AgentMessage[]): ScoredProduct[] {
  // Build map of tool_use_id → tool_name from all assistant messages
  const toolNames = new Map<string, string>();
  for (const msg of history) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content as Array<{ type: string; id?: string; name?: string }>) {
        if (block.type === "tool_use" && block.id && block.name) {
          toolNames.set(block.id, block.name);
        }
      }
    }
  }

  // Scan backwards for the most recent search_and_score_products result
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content as Array<{ type: string; tool_use_id?: string; content?: string }>) {
      if (
        block.type === "tool_result" &&
        block.tool_use_id &&
        toolNames.get(block.tool_use_id) === "search_and_score_products" &&
        typeof block.content === "string"
      ) {
        try {
          const parsed = JSON.parse(block.content) as { ok: boolean; results: ScoredProduct[] };
          if (parsed.ok && Array.isArray(parsed.results) && parsed.results.length > 0) {
            return parsed.results;
          }
        } catch {
          // malformed result, keep scanning
        }
      }
    }
  }
  return [];
}
