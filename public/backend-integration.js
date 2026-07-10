const PLATANDPAY_API_BASE = window.PLATANDPAY_API_BASE || "";
const PLATANDPAY_SESSION_KEY = "platandpay_backend_session_id";

function getBackendSessionId() {
  let sessionId = localStorage.getItem(PLATANDPAY_SESSION_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(PLATANDPAY_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function formatArs(value) {
  return Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function escapeHtml(value) {
  return String(value).replace(/[<>&"]/g, (char) => {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[char];
  });
}

function mapProposalToOffer(product, index) {
  const listPrice = Number(product.listPrice || product.price || 0);
  const price = Number(product.price || 0);
  
  let imgHtml = '<div style="background:linear-gradient(135deg,#667eea,#764ba2);width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:12px;font-size:2.25rem">🛒</div>';
  if (typeof window.iconForProduct === 'function') {
      imgHtml = window.iconForProduct({ ...product, imageUrl: product.imageUrl });
  }

  return {
    id: index,
    backendProductId: product.id,
    backendStoreId: product.storeId,
    store: product.storeName,
    product: product.name,
    originalPrice: listPrice,
    price,
    discount: Number(product.discountPct || 0),
    score: Number(product.score || 0),
    image: imgHtml,
    category: product.category || "otros",
    savings: Math.max(0, listPrice - price),
    description:
      `${(product.reasons || []).join(" · ")}${product.promo ? " · " + product.promo : ""}` ||
      "Propuesta generada por el agente.",
    reasons: product.reasons || [],
  };
}

function appendChatBubble(role, html) {
  const chatBox = document.getElementById("chat-messages");
  if (!chatBox) return;
  const div = document.createElement("div");
  if (role === "user") {
    div.className = "flex justify-end";
    div.innerHTML = `<div class="chat-bubble-user">${html}</div>`;
  } else {
    div.className = "flex gap-2 items-start";
    div.innerHTML = `
      <div class="w-7 h-7 flex-shrink-0 rounded-xl banana-gradient flex items-center justify-center text-base shadow-sm mt-0.5">🍌</div>
      <div class="chat-bubble-agent">${html}</div>
    `;
  }
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function callBackend(message) {
  const response = await fetch(`${PLATANDPAY_API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: getBackendSessionId(), message }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || "No se pudo conectar con PlatandPay API.");
  }
  return payload;
}

sendChatMessage = async function sendChatMessageIntegrated() {
  const input = document.getElementById("chat-input");
  const val = input.value.trim();
  if (!val) return;

  appendChatBubble("user", escapeHtml(val));
  input.value = "";
  appendChatBubble(
    "agent",
    '<span class="inline-flex items-center gap-x-2 text-slate-500"><i class="fas fa-spinner fa-spin"></i> Buscando y puntuando opciones...</span>',
  );

  // Limpiar resultados anteriores y mostrar skeleton
  const previewContainer = document.getElementById('preview-offers');
  const countEl = document.getElementById('offers-result-count');
  if (previewContainer) {
    previewContainer.innerHTML = `
      <div class="col-span-3 flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
        <i class="fas fa-spinner fa-spin text-3xl text-amber-400"></i>
        <span class="text-sm font-medium">Buscando productos...</span>
      </div>`;
  }
  if (countEl) countEl.textContent = 'Buscando...';

  try {
    const result = await callBackend(val);
    const chatBox = document.getElementById("chat-messages");
    chatBox.lastElementChild?.remove();

    if (Array.isArray(result.proposals) && result.proposals.length > 0) {
      state.offers = result.proposals.map(mapProposalToOffer);
      state.selectedOffers = [];
      saveState();
      renderPreviewOffers();
      renderOffers();
    } else {
      // No proposals
      if (previewContainer) {
        previewContainer.innerHTML = `
          <div class="col-span-3 flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
            <i class="fas fa-search text-3xl"></i>
            <span class="text-sm font-medium">No se encontraron productos. Intentá con otra búsqueda</span>
          </div>`;
      }
      if (countEl) countEl.textContent = '0 resultados encontrados';
    }

    const proposalHint = result.proposals?.length
      ? `<div class="mt-3"><button onclick="showView('ofertas')" class="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-black rounded-2xl font-extrabold text-xs">Ver ${result.proposals.length} propuestas</button></div>`
      : "";
    appendChatBubble("agent", `${escapeHtml(result.reply).replace(/\n/g, "<br>")}${proposalHint}`);
  } catch (error) {
    const chatBox = document.getElementById("chat-messages");
    chatBox.lastElementChild?.remove();
    appendChatBubble("agent", `<span class="text-red-600 font-semibold">${escapeHtml(error.message)}</span>`);
  }
};

confirmPurchase = async function confirmPurchaseIntegrated() {
  const selected = state.selectedOffers.map((idx) => state.offers[idx]).filter(Boolean);
  if (selected.length === 0) return;
  hideApprovalModal();

  const approvalMessage = "Apruebo";

  try {
    const result = await callBackend(approvalMessage);
    const totalSavings = selected.reduce((sum, offer) => sum + offer.savings, 0);
    const totalPaid = selected.reduce((sum, offer) => sum + offer.price, 0);

    state.saldo = Math.max(0, Math.round((state.saldo - totalPaid) * 100) / 100);
    state.presupuestoRestante = Math.max(0, state.presupuestoRestante - totalPaid);
    state.ahorroMes += totalSavings;
    state.historial.unshift({
      id: Date.now(),
      date: "Hoy",
      store: selected.length > 1 ? "Múltiples tiendas" : first.store,
      product: selected.length > 1 ? `${selected.length} productos` : first.product,
      saved: totalSavings,
      total: totalPaid,
      receiptId: result.purchaseReceipts?.[0]?.receiptId,
    });
    state.selectedOffers = [];
    saveState();
    updateAllUI();

    document.getElementById("success-savings").innerHTML = `$${formatArs(totalSavings)}`;
    document.getElementById("success-modal").style.display = "flex";
    appendChatBubble("user", escapeHtml(approvalMessage));
    appendChatBubble("agent", escapeHtml(result.purchaseReceipts?.[0]?.message || result.reply || "Compra simulada registrada."));
    launchConfetti();
  } catch (error) {
    appendChatBubble("agent", `<span class="text-red-600 font-semibold">${escapeHtml(error.message)}</span>`);
  }
};
