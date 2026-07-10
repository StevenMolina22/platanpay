"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { sendChatTurn } from "@/lib/platanpay-api";
import {
  createId,
  defaultState,
  formatArs,
  getBackendSessionId,
  loadPlatanPayState,
  mapProposalToOffer,
  savePlatanPayState,
  APP_STATE_KEY,
  type ChatMessage,
  type Offer,
  type PlatanPayState,
  type ViewName,
} from "@/lib/platanpay-state";
import { getOfferImageSource, getOfferEmoji } from "@/lib/product-icons";

const navItems: Array<{ view: ViewName; label: string; icon: string }> = [
  { view: "dashboard", label: "Mi Perfil", icon: "👤" },
  { view: "ofertas", label: "Ofertas", icon: "🏷️" },
  { view: "historial", label: "Historial", icon: "🧾" },
  { view: "perfil", label: "Resumen", icon: "📊" },
];

export function PlatanPayApp() {
  const [state, setState] = useState<PlatanPayState>(() => {
    if (typeof window === "undefined") return defaultState;
    return loadPlatanPayState();
  });
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeView, setActiveView] = useState<ViewName>("dashboard");
  const [detailOfferId, setDetailOfferId] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [successData, setSuccessData] = useState<{ savings: number; receiptId?: string; paymentMethod: string; items: Offer[] } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isPaymentPending, setIsPaymentPending] = useState(false);

  useEffect(() => {
    savePlatanPayState(state);
  }, [state]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(document.activeElement instanceof HTMLElement) || document.activeElement.tagName !== "BODY") return;
      if (event.key === "?") {
        event.preventDefault();
        setActiveView("chat");
      }
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        setActiveView("ofertas");
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedOffers = useMemo(
    () => state.selectedOfferIds.map((id) => state.offers.find((offer) => offer.id === id)).filter((offer): offer is Offer => Boolean(offer)),
    [state.offers, state.selectedOfferIds],
  );
  const detailOffer = detailOfferId ? state.offers.find((offer) => offer.id === detailOfferId) : undefined;
  const totalHistorySavings = state.historial.reduce((sum, item) => sum + item.saved, 0);

  function updateState(updater: (previous: PlatanPayState) => PlatanPayState) {
    setState(updater);
  }

  function login() {
    setIsLoggedIn(true);
    setActiveView("dashboard");
    setState((previous) => ensureWelcomeMessage(previous));
  }

  function logout() {
    if (!confirm("¿Cerrar sesión en PlatanPay WebApp?")) return;
    localStorage.removeItem(APP_STATE_KEY);
    setState(defaultState);
    setIsLoggedIn(false);
    setActiveView("dashboard");
  }

  function toggleOfferSelection(offerId: string) {
    updateState((previous) => ({
      ...previous,
      selectedOfferIds: previous.selectedOfferIds.includes(offerId)
        ? previous.selectedOfferIds.filter((id) => id !== offerId)
        : [...previous.selectedOfferIds, offerId],
    }));
  }

  function selectAllOffers() {
    updateState((previous) => ({ ...previous, selectedOfferIds: previous.offers.map((offer) => offer.id) }));
  }

  async function sendChatMessage(message: string) {
    const value = message.trim();
    if (!value || isSending) return;

    const loadingId = createId("msg-loading");
    setIsSending(true);
    setState((previous) => ({
      ...previous,
      chatMessages: [
        ...previous.chatMessages,
        { id: createId("msg"), role: "user", content: value },
        { id: loadingId, role: "agent", content: "Buscando y puntuando opciones...", status: "loading" },
      ],
    }));

    try {
      const result = await sendChatTurn(getBackendSessionId(), value);
      setState((previous) => ({
        ...previous,
        offers: result.proposals?.length
          ? result.proposals.map(mapProposalToOffer)
          : result.purchaseReceipts?.length
            ? []
            : previous.offers,
        selectedOfferIds: result.proposals?.length || result.purchaseReceipts?.length ? [] : previous.selectedOfferIds,
        chatMessages: [
          ...previous.chatMessages.filter((messageItem) => messageItem.id !== loadingId),
          {
            id: createId("msg"),
            role: "agent",
            content: result.reply,
            action: result.proposals?.length
              ? { label: `Ver ${result.proposals.length} propuestas`, view: "ofertas" }
              : undefined,
          },
        ],
      }));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "No se pudo completar la búsqueda.";
      setState((previous) => ({
        ...previous,
        chatMessages: [
          ...previous.chatMessages.filter((messageItem) => messageItem.id !== loadingId),
          { id: createId("msg"), role: "agent", content: messageText, status: "error" },
        ],
      }));
    } finally {
      setIsSending(false);
    }
  }

  async function confirmPurchase(paymentMethod: string) {
    if (selectedOffers.length === 0 || isSending) return;
    setApprovalOpen(false);

    const first = selectedOffers[0];
    const itemsSnapshot = [...selectedOffers];
    const totalSavings = selectedOffers.reduce((sum, offer) => sum + offer.savings, 0);
    const totalPaid = selectedOffers.reduce((sum, offer) => sum + offer.price, 0);
    const approvalMessage = "Apruebo";

    setIsSending(true);
    setIsPaymentPending(true);
    try {
      const result = await sendChatTurn(getBackendSessionId(), approvalMessage);
      const receipt = result.purchaseReceipts?.[0];
      setState((previous) => ({
        ...previous,
        saldo: Math.max(0, Math.round((previous.saldo - totalPaid) * 100) / 100),
        presupuestoRestante: Math.max(0, previous.presupuestoRestante - totalPaid),
        ahorroMes: previous.ahorroMes + totalSavings,
        historial: [
          {
            id: createId("hist"),
            date: "Hoy",
            store: selectedOffers.length > 1 ? "Múltiples tiendas" : first.store,
            product: selectedOffers.length > 1 ? `${selectedOffers.length} productos` : first.product,
            saved: totalSavings,
            total: totalPaid,
            receiptId: receipt?.receiptId,
          },
          ...previous.historial,
        ],
        offers: [],
        selectedOfferIds: [],
        chatMessages: [
          ...previous.chatMessages,
          { id: createId("msg"), role: "user", content: approvalMessage },
          { id: createId("msg"), role: "agent", content: receipt?.message || result.reply || "Compra simulada registrada." },
        ],
      }));
      setSuccessData({ savings: totalSavings, receiptId: receipt?.receiptId, paymentMethod, items: itemsSnapshot });
      launchConfetti();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "No se pudo confirmar la compra.";
      setState((previous) => ({
        ...previous,
        chatMessages: [...previous.chatMessages, { id: createId("msg"), role: "agent", content: messageText, status: "error" }],
      }));
    } finally {
      setIsSending(false);
      setIsPaymentPending(false);
    }
  }

  if (!isLoggedIn) {
    return <LoginView onLogin={login} />;
  }

  return (
    <div className="min-h-screen app-bg">
      <TopNav userName={state.user.name} avatar={state.user.avatar} activeView={activeView} onNavigate={setActiveView} />
      <main className="mx-auto max-w-screen-2xl px-6 py-6 md:px-10">
        {activeView === "dashboard" && (
          <DashboardView
            state={state}
            isSending={isSending}
            totalHistorySavings={totalHistorySavings}
            onNavigate={setActiveView}
            onSendMessage={sendChatMessage}
            onShowOffer={setDetailOfferId}
          />
        )}
        {activeView === "ofertas" && (
          <OffersView
            offers={state.offers}
            selectedOfferIds={state.selectedOfferIds}
            onSelectAll={selectAllOffers}
            onToggleSelection={toggleOfferSelection}
            onReview={() => setApprovalOpen(true)}
            onShowOffer={setDetailOfferId}
          />
        )}
        {activeView === "historial" && <HistoryView history={state.historial} totalSavings={totalHistorySavings} />}
        {activeView === "chat" && (
          <FullChatView
            messages={state.chatMessages}
            isSending={isSending}
            onSendMessage={sendChatMessage}
            onNavigate={setActiveView}
          />
        )}
        {activeView === "perfil" && <ProfileView state={state} onLogout={logout} />}
      </main>

      {detailOffer && (
        <OfferDetailModal
          offer={detailOffer}
          selected={state.selectedOfferIds.includes(detailOffer.id)}
          onClose={() => setDetailOfferId(null)}
          onAdd={() => {
            if (!state.selectedOfferIds.includes(detailOffer.id)) toggleOfferSelection(detailOffer.id);
            setDetailOfferId(null);
            setActiveView("ofertas");
          }}
        />
      )}
      {approvalOpen && (
        <ApprovalModal selectedOffers={selectedOffers} onClose={() => setApprovalOpen(false)} onConfirm={confirmPurchase} />
      )}
      {isPaymentPending && <ProcessingModal />}
      {successData !== null && (
        <SuccessModal
          data={successData}
          onClose={() => {
            setSuccessData(null);
            setActiveView("dashboard");
          }}
        />
      )}
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="w-full max-w-5xl">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <section className="text-center md:text-left">
            <div className="mb-6 flex items-center justify-center gap-x-4 md:justify-start">
              <div className="banana-gradient banana-float flex h-16 w-16 items-center justify-center rounded-3xl text-6xl shadow-2xl">🍌</div>
              <span className="logo-font text-6xl font-extrabold tracking-tighter text-white">PlatanPay</span>
            </div>
            <h1 className="mb-4 text-5xl font-extrabold leading-none tracking-tighter text-white md:text-6xl">
              Tu agente IA
              <br />
              que encuentra
              <br />
              las mejores ofertas
              <br />y paga por vos
            </h1>
            <p className="mx-auto mb-8 max-w-md text-xl text-slate-300 md:mx-0">
              Ahorra tiempo y dinero. La IA busca, compara y paga por ti en Carrefour, Mercado Libre, Club Bepo y más.
            </p>
            <div className="flex flex-wrap justify-center gap-3 md:justify-start">
              <BadgeText>✓ Sin tarjeta • 30 días gratis</BadgeText>
              <BadgeText>✓ Integrado con Mercado Pago</BadgeText>
            </div>
          </section>

          <section className="mx-auto w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl md:p-10">
            <div className="mb-8 text-center">
              <div className="banana-gradient mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-4xl">🍌</div>
              <h2 className="text-3xl font-extrabold tracking-tight">Bienvenido de nuevo</h2>
              <p className="mt-1 text-slate-500">Inicia sesión para ver tus ahorros</p>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-600">Email</span>
                <input
                  type="email"
                  defaultValue="ana.mendez@email.com"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3.5 text-sm outline-none transition-all focus:border-yellow-400"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-600">Contraseña</span>
                <input
                  type="password"
                  defaultValue="demo123"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3.5 text-sm outline-none transition-all focus:border-yellow-400"
                />
              </label>
              <button
                type="button"
                onClick={onLogin}
                className="platanpay-btn mt-2 flex w-full items-center justify-center gap-x-3 rounded-2xl bg-yellow-400 py-4 text-lg font-extrabold text-black shadow-lg hover:bg-yellow-500 active:bg-yellow-600"
              >
                <span>Entrar a PlatanPay</span>
                <span aria-hidden>→</span>
              </button>
              <button
                type="button"
                onClick={onLogin}
                className="flex w-full items-center justify-center gap-x-2 py-3 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-800"
              >
                🚀 Entrar directamente en modo Demo
              </button>
            </div>
            <p className="mt-6 text-center text-xs text-slate-400">
              ¿Nuevo en PlatanPay? <span className="font-semibold text-yellow-600">Crear cuenta gratis</span>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function TopNav({
  userName,
  avatar,
  activeView,
  onNavigate,
}: {
  userName: string;
  avatar: string;
  activeView: ViewName;
  onNavigate: (view: ViewName) => void;
}) {
  return (
    <nav className="glass-nav sticky top-0 z-50">
      <div className="mx-auto max-w-screen-2xl px-6 md:px-10">
        <div className="flex h-14 items-center justify-between gap-6">
          <button type="button" onClick={() => onNavigate("dashboard")} className="flex flex-shrink-0 items-center gap-2.5">
            <span className="banana-gradient flex h-8 w-8 items-center justify-center rounded-xl text-lg shadow-sm">🍌</span>
            <span className="logo-font text-xl font-extrabold tracking-tight text-slate-900">PlatanPay</span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">WEB</span>
          </button>
          <div className="hidden items-center gap-1 text-[13px] font-medium md:flex">
            {navItems.map((item) => (
              <button
                key={item.view}
                type="button"
                onClick={() => onNavigate(item.view)}
                className={`nav-link flex items-center gap-1.5 px-4 py-1.5 text-slate-600 ${activeView === item.view ? "active" : ""}`}
              >
                <span aria-hidden>{item.icon}</span> {item.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => onNavigate("perfil")} className="flex items-center gap-3">
            <span className="hidden text-right md:block">
              <span className="block text-sm font-semibold leading-tight text-slate-800">{userName.split(" ").slice(0, 2).join(" ")}</span>
              <span className="flex items-center justify-end gap-1 text-[11px] font-semibold text-amber-600">⭐ Oro</span>
            </span>
            <span className="block h-9 w-9 overflow-hidden rounded-xl border-2 border-amber-300 shadow-sm ring-2 ring-amber-100">
              <Image src={avatar} alt={userName} width={40} height={40} className="h-full w-full object-cover" />
            </span>
          </button>
        </div>
      </div>
    </nav>
  );
}

function DashboardView({
  state,
  isSending,
  totalHistorySavings,
  onNavigate,
  onSendMessage,
  onShowOffer,
}: {
  state: PlatanPayState;
  isSending: boolean;
  totalHistorySavings: number;
  onNavigate: (view: ViewName) => void;
  onSendMessage: (message: string) => void;
  onShowOffer: (id: string) => void;
}) {
  const budgetPct = Math.round((state.presupuestoRestante / state.presupuestoTotal) * 100);

  return (
    <section>
      <div className="sub-header-banner -mx-6 mb-5 flex flex-col gap-3 px-6 md:-mx-10 md:flex-row md:items-center md:justify-between md:px-10">
        <p className="text-sm font-medium text-slate-700">Aquí tienes un resumen de tus finanzas y ahorros de hoy</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate("ofertas")}
            className="flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-amber-600"
          >
            ✨ Ver ofertas del día
          </button>
          <div className="flex items-center gap-2 text-xs text-slate-500">⏱ Datos actualizados hace 2 min <span className="mock-label">DEMO</span></div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard accent="teal" label="Saldo disponible" value={`$${formatArs(state.saldo)}`} helper="Listo para compras aprobadas" />
        <MetricCard accent="amber" label="Presupuesto disponible" value={`$${formatArs(state.presupuestoRestante)}`} helper={`${budgetPct}% del presupuesto mensual`} />
        <MetricCard accent="emerald" label="Total ahorrado" value={`$${formatArs(totalHistorySavings)}`} helper="Historial completo" />
      </div>

      <div className="flex min-h-[520px] flex-col gap-5 xl:h-[calc(100vh-290px)] xl:flex-row">
        <div className="w-full flex-shrink-0 xl:w-80">
          <ChatPanel messages={state.chatMessages} isSending={isSending} compact onNavigate={onNavigate} onSendMessage={onSendMessage} />
        </div>
        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight">Resultados de Búsqueda de Agente</h2>
              <div className="mt-0.5 text-xs text-slate-500">
                {state.offers.length} resultado{state.offers.length === 1 ? "" : "s"} encontrado{state.offers.length === 1 ? "" : "s"}
              </div>
            </div>
            <button type="button" className="filter-btn">☰ Filtros y Ordenar ˅</button>
          </div>
          <OffersPreview offers={state.offers} onShowOffer={onShowOffer} />
        </div>
      </div>
    </section>
  );
}

function MetricCard({ accent, label, value, helper }: { accent: "teal" | "amber" | "emerald"; label: string; value: string; helper: string }) {
  return (
    <div className={`metric-card accent-${accent} modern-card rounded-3xl bg-white px-6 py-5`}>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="metric-value mt-2 font-mono text-3xl font-extrabold text-slate-900">{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{helper}</div>
    </div>
  );
}

function ChatPanel({
  messages,
  isSending,
  compact,
  onSendMessage,
  onNavigate,
}: {
  messages: ChatMessage[];
  isSending: boolean;
  compact?: boolean;
  onSendMessage: (message: string) => void;
  onNavigate: (view: ViewName) => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function submit(message = input) {
    if (!message.trim()) return;
    onSendMessage(message);
    setInput("");
  }

  const visibleMessages = messages.length ? messages : [welcomeMessage(defaultState.user.name, defaultState.ahorroMes)];

  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="chat-panel-header">
        <div className="flex items-center gap-2.5">
          <div className="banana-gradient flex h-9 w-9 items-center justify-center rounded-xl text-xl shadow-sm">🍌</div>
          <div>
            <div className="text-sm font-extrabold">Agente Platan</div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
            </div>
          </div>
        </div>
        <span className="text-sm text-slate-400">📖</span>
      </div>
      <div ref={scrollRef} className={`${compact ? "p-3" : "p-6"} flex-1 space-y-3 overflow-y-auto bg-white text-sm`}>
        {visibleMessages.map((message) => (
          <ChatBubble key={message.id} message={message} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2">
        <button type="button" className="quick-pill" onClick={() => submit("Ver mis ahorros")}>🐷 Ver Ahorros</button>
        <button type="button" className="quick-pill" onClick={() => submit("Preguntas frecuentes")}>❔ Preguntas</button>
        <button type="button" className="quick-pill" onClick={() => submit("Configura el agente")}>🎚 Configurar</button>
      </div>
      <div className="flex gap-2 border-t border-slate-100 bg-white p-2.5">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={compact ? "Escriba un texto para aumentar..." : "Pregúntale al agente..."}
          className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none transition-colors focus:border-amber-400"
        />
        <button
          type="button"
          disabled={isSending}
          onClick={() => submit()}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-400 text-black shadow-sm transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSending ? "…" : "➤"}
        </button>
      </div>
    </section>
  );
}

function FullChatView({
  messages,
  isSending,
  onSendMessage,
  onNavigate,
}: {
  messages: ChatMessage[];
  isSending: boolean;
  onSendMessage: (message: string) => void;
  onNavigate: (view: ViewName) => void;
}) {
  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center gap-x-4">
        <div className="banana-gradient flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-3xl text-5xl shadow-inner">🍌</div>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Agente Platan</h1>
          <div className="flex items-center gap-x-2 text-emerald-600">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="font-semibold">En línea • Responde en segundos</span>
            <span className="mock-label ml-2">IA</span>
          </div>
        </div>
      </div>
      <ChatPanel messages={messages} isSending={isSending} onSendMessage={onSendMessage} onNavigate={onNavigate} />
      <p className="mt-3 text-center text-xs text-slate-400">Este chat está conectado al endpoint de agente de la app.</p>
    </section>
  );
}

function ChatBubble({ message, onNavigate }: { message: ChatMessage; onNavigate: (view: ViewName) => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="chat-bubble-user">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="banana-gradient mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl text-xl shadow-sm">🍌</div>
      <div className={`chat-bubble-agent ${message.status === "error" ? "font-semibold text-red-600" : ""}`}>
        {message.status === "loading" ? <span className="text-slate-500">⌛ {message.content}</span> : message.content}
        {message.action && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => onNavigate(message.action?.view ?? "ofertas")}
              className="rounded-2xl bg-yellow-400 px-4 py-2 text-xs font-extrabold text-black hover:bg-yellow-500"
            >
              {message.action.label}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OffersPreview({ offers, onShowOffer }: { offers: Offer[]; onShowOffer: (id: string) => void }) {
  if (!offers.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-slate-400">
        <span className="text-4xl">🔎</span>
        <span className="text-sm font-medium">Hablale al agente para ver productos</span>
      </div>
    );
  }

  return (
    <div className="grid content-start gap-3 overflow-y-auto pb-4 pr-1 md:grid-cols-2 xl:grid-cols-3">
      {offers.slice(0, 12).map((offer) => (
        <button key={offer.id} type="button" onClick={() => onShowOffer(offer.id)} className="product-card-h text-left">
          <OfferImage offer={offer} className="img-box text-3xl" />
          <span className="min-w-0 flex-1">
            <span className="pname block" title={offer.product}>
              {truncate(offer.product, 45)}
            </span>
            <span className="pstore block">{offer.store || "Tienda"}</span>
            <span className="mt-1.5 flex items-center justify-between gap-2">
              <span className="pprice">${formatArs(offer.price)}</span>
              {offer.discount > 0 && <span className="pbadge discount">-{offer.discount}%</span>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function OffersView({
  offers,
  selectedOfferIds,
  onSelectAll,
  onToggleSelection,
  onReview,
  onShowOffer,
}: {
  offers: Offer[];
  selectedOfferIds: string[];
  onSelectAll: () => void;
  onToggleSelection: (id: string) => void;
  onReview: () => void;
  onShowOffer: (id: string) => void;
}) {
  return (
    <section>
      <div className="mb-6 flex flex-col gap-y-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Propuesta del Agente para hoy</h1>
          <div className="mt-1 flex items-center gap-x-2">
            <span className="font-medium text-emerald-600">{offers.length} ofertas exclusivas</span>
            <span className="mock-label">SIMULADO</span>
          </div>
        </div>
        <div className="flex items-center gap-x-3">
          <button type="button" onClick={onSelectAll} className="flex items-center gap-x-2 rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-semibold transition-all hover:bg-slate-50">
            ✓✓ <span>Seleccionar todas</span>
          </button>
          {selectedOfferIds.length > 0 && (
            <button
              type="button"
              onClick={onReview}
              className="flex items-center gap-x-2 rounded-2xl bg-yellow-400 px-6 py-2.5 font-extrabold text-black shadow transition-all hover:bg-yellow-500 active:bg-yellow-600"
            >
              Revisar y Aprobar <span>{selectedOfferIds.length}</span>
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {offers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            selected={selectedOfferIds.includes(offer.id)}
            onToggleSelection={onToggleSelection}
            onShowOffer={onShowOffer}
          />
        ))}
      </div>
    </section>
  );
}

function OfferCard({
  offer,
  selected,
  onToggleSelection,
  onShowOffer,
}: {
  offer: Offer;
  selected: boolean;
  onToggleSelection: (id: string) => void;
  onShowOffer: (id: string) => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onShowOffer(offer.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onShowOffer(offer.id);
      }}
      className={`offer-card modern-card flex cursor-pointer flex-col rounded-3xl bg-white p-5 ${selected ? "border-yellow-400 bg-yellow-50/30 ring-2 ring-yellow-200" : "border-slate-200"}`}
    >
      <div className="flex flex-1 items-start gap-4">
        <OfferImage offer={offer} className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-3xl shadow-inner" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-extrabold leading-tight">{offer.product}</h3>
              <div className="mt-0.5 text-xs font-medium text-slate-500">{offer.store} • {offer.category}</div>
            </div>
            {offer.discount > 0 && <div className="discount-badge flex-shrink-0">-{offer.discount}%</div>}
          </div>
          <div className="mt-3 flex items-baseline gap-x-2">
            <span className="text-3xl font-extrabold tracking-tighter">${formatArs(offer.price)}</span>
            {offer.discount > 0 && <span className="price-old text-base">${formatArs(offer.originalPrice)}</span>}
          </div>
          {offer.savings > 0 && <div className="mt-1 text-xs font-bold text-emerald-600">Ahorrás ${formatArs(offer.savings)}</div>}
        </div>
      </div>
      <div className="mt-5 flex gap-2 border-t pt-4">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelection(offer.id);
          }}
          className={`flex-1 rounded-2xl py-2.5 text-xs font-extrabold transition-all ${selected ? "bg-amber-400 text-black shadow-inner" : "bg-slate-900 text-white shadow-md hover:bg-slate-800 hover:shadow-lg"}`}
        >
          {selected ? "✓ Seleccionado" : "Seleccionar"}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onShowOffer(offer.id);
          }}
          className="rounded-2xl border border-slate-300 px-5 py-2.5 text-xs font-bold transition-colors hover:bg-slate-50"
        >
          Detalle
        </button>
      </div>
    </article>
  );
}

function OfferDetailModal({ offer, selected, onClose, onAdd }: { offer: Offer; selected: boolean; onClose: () => void; onAdd: () => void }) {
  return (
    <Modal onClose={onClose} zIndex="z-[70]">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="p-7">
          <div className="mb-5 flex items-start justify-between">
            <h2 className="text-2xl font-extrabold">Detalle de la oferta</h2>
            <button type="button" onClick={onClose} className="-mr-2 flex h-9 w-9 items-center justify-center text-2xl text-slate-400 hover:text-slate-600">×</button>
          </div>
          <div className="space-y-5 text-sm">
            <div className="flex gap-5">
              <OfferImage offer={offer} className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-slate-100 text-5xl shadow-inner" />
              <div className="flex-1">
                <h3 className="text-2xl font-extrabold">{offer.product}</h3>
                <div className="font-medium text-emerald-600">{offer.store} • {offer.category}</div>
                <div className="mt-3 flex items-baseline gap-x-3">
                  <span className="text-5xl font-extrabold tracking-tighter">${formatArs(offer.price)}</span>
                  {offer.discount > 0 && <span className="price-old text-2xl">${formatArs(offer.originalPrice)}</span>}
                </div>
                {(offer.discount > 0 || offer.savings > 0) && (
                  <div className="mt-2 inline-flex items-center gap-x-2">
                    {offer.discount > 0 && <div className="discount-badge">-{offer.discount}% OFF</div>}
                    {offer.savings > 0 && <span className="text-sm font-bold text-emerald-600">Ahorrás ${formatArs(offer.savings)}</span>}
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold text-slate-600">Descripción</div>
              <p className="text-sm leading-relaxed text-slate-700">{offer.description}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3 border-t bg-slate-50 p-5">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 py-3.5 text-sm font-semibold transition-colors hover:bg-white">Cerrar</button>
          <button
            type="button"
            onClick={onAdd}
            disabled={selected}
            className="platanpay-btn flex-1 rounded-2xl bg-yellow-400 py-3.5 text-sm font-extrabold text-black hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {selected ? "Ya está en tu propuesta" : "Añadir a mi propuesta"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const PAYMENT_METHODS = [
  { id: "mercadopago", label: "Mercado Pago", icon: "💳", description: "Pagá con tu saldo o cuotas sin interés" },
  { id: "credito", label: "Tarjeta de crédito", icon: "💳", description: "Visa, Mastercard, American Express" },
  { id: "debito", label: "Tarjeta de débito", icon: "🏦", description: "Débito inmediato de tu cuenta" },
  { id: "modo", label: "MODO", icon: "📱", description: "App de pagos interoperables" },
] as const;

type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

function ApprovalModal({
  selectedOffers,
  onClose,
  onConfirm,
}: {
  selectedOffers: Offer[];
  onClose: () => void;
  onConfirm: (paymentMethod: string) => void;
}) {
  const [step, setStep] = useState<"review" | "payment">("review");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>("mercadopago");

  const total = selectedOffers.reduce((sum, offer) => sum + offer.price, 0);
  const totalSavings = selectedOffers.reduce((sum, offer) => sum + offer.savings, 0);
  const selectedMethodLabel = PAYMENT_METHODS.find((m) => m.id === paymentMethod)?.label ?? paymentMethod;

  return (
    <Modal onClose={onClose} zIndex="z-[70]">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Step indicator */}
        <div className="flex items-center gap-2 border-b bg-slate-50 px-7 py-3">
          {(["review", "payment"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-6 bg-slate-300" />}
              <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${step === s || (s === "review") ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                {i + 1}
              </div>
              <span className={`text-xs font-semibold ${step === s ? "text-slate-800" : "text-slate-400"}`}>
                {s === "review" ? "Resumen" : "Pago"}
              </span>
            </div>
          ))}
        </div>

        {step === "review" && (
          <>
            <div className="p-7">
              <div className="mb-5 flex justify-between">
                <div>
                  <h2 className="text-2xl font-extrabold">Revisar propuesta</h2>
                  <div className="text-sm text-slate-500">{selectedOffers.length} {selectedOffers.length === 1 ? "producto" : "productos"} seleccionados</div>
                </div>
                <button type="button" onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
              </div>
              <div className="mb-5 max-h-[220px] space-y-3 overflow-auto pr-2">
                {selectedOffers.map((offer) => (
                  <div key={offer.id} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-3.5">
                    <OfferImage offer={offer} className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 text-2xl" />
                    <div className="flex-1 text-sm">
                      <div className="font-extrabold">{offer.product}</div>
                      <div className="text-xs text-emerald-600">{offer.store}</div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <div><span className="font-mono text-lg font-extrabold">${formatArs(offer.price)}</span>{" "}<span className="price-old text-xs">${formatArs(offer.originalPrice)}</span></div>
                        {offer.discount > 0 && <div className="discount-badge">-{offer.discount}%</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-emerald-700">Total a pagar</span>
                  <span className="font-mono text-lg font-extrabold">${formatArs(total)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-emerald-700">Ahorro total</span>
                  <span className="text-3xl font-extrabold tracking-tighter text-emerald-600">${formatArs(totalSavings)}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 border-t bg-slate-50 p-5">
              <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 bg-white py-3.5 text-sm font-semibold hover:bg-slate-50">Cancelar</button>
              <button
                type="button"
                onClick={() => setStep("payment")}
                disabled={selectedOffers.length === 0}
                className="platanpay-btn flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-sm font-extrabold text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                Elegir método de pago →
              </button>
            </div>
          </>
        )}

        {step === "payment" && (
          <>
            <div className="p-7">
              <div className="mb-5 flex justify-between">
                <div>
                  <h2 className="text-2xl font-extrabold">Método de pago</h2>
                  <div className="text-sm text-slate-500">Total a pagar: <span className="font-bold text-slate-700">${formatArs(total)}</span></div>
                </div>
                <button type="button" onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
              </div>
              <div className="space-y-2.5">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setPaymentMethod(method.id)}
                    className={`flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all ${
                      paymentMethod === method.id
                        ? "border-emerald-400 bg-emerald-50"
                        : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-2xl">{method.icon}</span>
                    <div className="flex-1">
                      <div className="font-extrabold text-slate-800">{method.label}</div>
                      <div className="text-xs text-slate-500">{method.description}</div>
                    </div>
                    <div className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${paymentMethod === method.id ? "border-emerald-500 bg-emerald-500" : "border-slate-300"}`} />
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
                <span>🔒</span>
                <span>Pago 100% simulado — ningún cargo real será efectuado</span>
              </div>
            </div>
            <div className="flex gap-3 border-t bg-slate-50 p-5">
              <button type="button" onClick={() => setStep("review")} className="flex-1 rounded-2xl border border-slate-300 bg-white py-3.5 text-sm font-semibold hover:bg-slate-50">← Volver</button>
              <button
                type="button"
                onClick={() => onConfirm(paymentMethod)}
                className="platanpay-btn flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-sm font-extrabold text-white hover:bg-emerald-600"
              >
                🔒 Confirmar con {selectedMethodLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ProcessingModal() {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="flex w-full max-w-xs flex-col items-center gap-5 rounded-3xl bg-white p-10 text-center shadow-2xl">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-500" />
          <span className="text-2xl">🍌</span>
        </div>
        <div>
          <div className="text-lg font-extrabold">Procesando pago...</div>
          <div className="mt-1 text-sm text-slate-500">El agente está confirmando tu compra</div>
        </div>
      </div>
    </div>
  );
}

function SuccessModal({ data, onClose }: { data: { savings: number; receiptId?: string; paymentMethod: string; items: Offer[] }; onClose: () => void }) {
  const methodLabel = PAYMENT_METHODS.find((m) => m.id === data.paymentMethod)?.label ?? data.paymentMethod;
  return (
    <Modal onClose={onClose} zIndex="z-[80]" dark>
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="p-9 text-center">
          <div className="success-check mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-5xl text-emerald-500">✓</div>
          <h2 className="mb-1 text-4xl font-extrabold tracking-tight">¡Compra aprobada!</h2>
          <p className="mb-6 text-base text-slate-500">Pagaste con <span className="font-bold text-slate-700">{methodLabel}</span></p>

          {/* Items */}
          <div className="mb-4 space-y-2 text-left">
            {data.items.map((offer) => (
              <div key={offer.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <OfferImage offer={offer} className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-lg" />
                  <span className="font-semibold text-slate-700 line-clamp-1">{offer.product}</span>
                </div>
                <span className="font-mono font-bold">${formatArs(offer.price)}</span>
              </div>
            ))}
          </div>

          {/* Savings highlight */}
          <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Ahorro total</div>
            <div className="text-4xl font-extrabold tracking-tighter text-emerald-600">${formatArs(data.savings)}</div>
          </div>

          {/* Receipt */}
          {data.receiptId && (
            <div className="mb-5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-xs text-slate-500">
              <span className="font-semibold text-slate-600">Comprobante:</span> <span className="font-mono">{data.receiptId}</span>
              <br />Recibirás confirmación por email y WhatsApp en 24–48 hs.
            </div>
          )}
        </div>
        <div className="border-t p-5">
          <button type="button" onClick={onClose} className="w-full rounded-2xl bg-yellow-400 py-4 text-sm font-extrabold text-black hover:bg-yellow-500 active:scale-[0.985]">
            Volver al Dashboard
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryView({ history, totalSavings }: { history: PlatanPayState["historial"]; totalSavings: number }) {
  return (
    <section>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Historial de Ahorros</h1>
          <p className="text-slate-600">Tus compras inteligentes y el dinero que has ahorrado</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">TOTAL AHORRADO</div>
          <div className="font-mono text-4xl font-extrabold text-emerald-600">${formatArs(totalSavings)}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {history.map((item) => (
          <div key={item.id} className="modern-card flex items-center gap-4 rounded-3xl border border-slate-100 bg-white p-5">
            <div className="flex-shrink-0">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-2xl text-emerald-600">🧾</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div className="font-extrabold">{item.product}</div>
                <div className="font-mono text-lg font-extrabold text-emerald-600">+${formatArs(item.saved)}</div>
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>{item.store} • {item.date}</span>
                <span className="font-mono">Total ${formatArs(item.total)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileView({ state, onLogout }: { state: PlatanPayState; onLogout: () => void }) {
  return (
    <section className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 h-24 w-24 overflow-hidden rounded-full border-4 border-yellow-300 shadow-xl ring-8 ring-yellow-100">
          <Image src={state.user.avatar} alt={state.user.name} width={96} height={96} className="h-full w-full object-cover" />
        </div>
        <h1 className="text-3xl font-extrabold">{state.user.name}</h1>
        <div className="font-semibold text-emerald-600">Nivel Oro • Miembro desde {state.user.memberSince}</div>
      </div>
      <div className="mb-10 space-y-4">
        <h2 className="text-xl font-extrabold text-slate-800">Mi Resumen Financiero</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SummaryCard icon="💳" label="Saldo en cuenta" value={`$${formatArs(state.saldo)},50`} />
          <SummaryCard icon="🐷" label="Ahorro del mes" value={`$${formatArs(state.ahorroMes)}`} highlight />
          <SummaryCard icon="📈" label="Presupuesto Mensual" value={`$${formatArs(state.presupuestoTotal)}`} />
          <SummaryCard icon="🪙" label="Presupuesto Disponible" value={`$${formatArs(state.presupuestoRestante)}`} />
        </div>
      </div>
      <div className="mb-10 space-y-4">
        <h2 className="text-xl font-extrabold text-slate-800">Preguntas Frecuentes (FAQ)</h2>
        <FaqCard title="¿Cómo funciona el agente IA?">PlatanPay analiza tus solicitudes, busca en múltiples tiendas en tiempo real, compara precios, descuentos y promociones, y te sugiere la mejor opción para maximizar tu ahorro.</FaqCard>
        <FaqCard title="¿Cómo se realiza el pago?">Una vez que apruebas una propuesta, PlatanPay utiliza tu saldo disponible para realizar la compra de forma automática y segura en la tienda correspondiente.</FaqCard>
        <FaqCard title="¿De dónde provienen las imágenes de los productos?">Priorizamos las imágenes originales de los comercios. Si no, generamos una fotografía del producto basada en su descripción.</FaqCard>
        <FaqCard title="¿Es seguro vincular mi cuenta bancaria?">Sí, PlatanPay utiliza protocolos de encriptación de grado bancario y solo opera con tu consentimiento explícito previo a la compra.</FaqCard>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="modern-card flex w-full items-center justify-between rounded-3xl border border-slate-100 bg-white px-6 py-5 text-red-600 transition-colors hover:bg-red-50"
      >
        <span className="flex items-center gap-x-4"><span className="text-2xl">↪</span><span className="font-semibold">Cerrar sesión</span></span>
      </button>
      <div className="mt-10 text-center text-xs text-slate-400">Versión WebApp Demo v1.6 • Datos simulados • <span className="font-mono">PlatanPay © 2026</span></div>
    </section>
  );
}

function SummaryCard({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="modern-card rounded-3xl border border-slate-100 bg-white px-6 py-5">
      <div className="mb-2 flex items-center gap-x-4">
        <span className="w-6 text-xl">{icon}</span>
        <div className="font-semibold text-slate-700">{label}</div>
      </div>
      <div className={`font-mono text-3xl font-extrabold ${highlight ? "text-emerald-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function FaqCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="modern-card rounded-3xl border border-slate-100 bg-white px-6 py-5">
      <h3 className="mb-2 text-lg font-bold text-slate-800">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-600">{children}</p>
    </div>
  );
}

function OfferImage({ offer, className }: { offer: Offer; className: string }) {
  const [failed, setFailed] = useState(false);
  if (offer.image && !offer.image.startsWith("<")) return <span className={className}>{offer.image}</span>;

  const src = getOfferImageSource(offer);
  if (failed || !src) return <OfferImagePlaceholder offer={offer} className={className} />;

  return (
    <span className={className}>
      {/* Merchant image hosts are dynamic, so next/image remotePatterns cannot cover them safely. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={offer.product}
        className="h-full w-full rounded-[inherit] object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function OfferImagePlaceholder({ offer, className }: { offer: Offer; className: string }) {
  const emoji = getOfferEmoji(offer);
  return (
    <span className={`${className} relative bg-gradient-to-br from-slate-50 to-slate-100`}>
      <span className="relative flex h-full w-full items-center justify-center rounded-[inherit]">
        <span className="text-[1.6em] leading-none select-none">{emoji}</span>
      </span>
    </span>
  );
}

function Modal({ children, onClose, zIndex, dark }: { children: ReactNode; onClose: () => void; zIndex: string; dark?: boolean }) {
  return (
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-6 ${dark ? "bg-black/70" : "bg-black/60 backdrop-blur-md"}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

function BadgeText({ children }: { children: ReactNode }) {
  return <div className="inline-flex items-center gap-x-2 rounded-2xl bg-white/10 px-4 py-2 text-sm text-white backdrop-blur-md">{children}</div>;
}

function welcomeMessage(userName: string, ahorroMes: number): ChatMessage {
  return {
    id: "welcome",
    role: "agent",
    content: `¡Hola ${userName.split(" ")[0]}! Soy tu agente Platan 🍌. Este mes ya te ahorré $${formatArs(ahorroMes)} con las propuestas que te preparé. ¿En qué te puedo ayudar?`,
  };
}

function ensureWelcomeMessage(state: PlatanPayState): PlatanPayState {
  if (state.chatMessages.length > 0) return state;
  return { ...state, chatMessages: [welcomeMessage(state.user.name, state.ahorroMes)] };
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.substring(0, length)}…` : value;
}

function launchConfetti() {
  const colors = ["#facc15", "#22c55e"];
  for (let index = 0; index < 70; index += 1) {
    const particle = document.createElement("div");
    particle.style.cssText = `position:fixed;z-index:99999;width:9px;height:9px;left:${Math.random() * window.innerWidth}px;top:-30px;background:${colors[index % 2]};border-radius:${Math.random() > 0.6 ? "50%" : "3px"};pointer-events:none`;
    document.body.appendChild(particle);
    particle.animate(
      [
        { transform: "translateY(0) rotate(0deg)", opacity: 1 },
        { transform: `translateY(${window.innerHeight + 120}px) rotate(${Math.random() * 400}deg)`, opacity: 0 },
      ],
      { duration: 1600 + Math.random() * 900, easing: "cubic-bezier(0.25,0.1,0.25,1)" },
    ).onfinish = () => particle.remove();
  }
}
