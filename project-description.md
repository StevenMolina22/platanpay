# PlatandPay

An AI shopping agent for Argentina that finds the best deals across supermarkets and marketplaces — and only buys with explicit human approval.

---

## Product

PlatandPay is a chat-based shopping assistant. You tell it what you need, it searches across Carrefour, Coto, Jumbo, Mercado Libre and Club de Beneficios, scores each option, and presents the top 3 with prices, discounts, shipping, and store reputation. You say "dale", it simulates the purchase. Nothing real is charged — the purchase layer is mocked to demonstrate the flow safely.

---

## Agent

Built on Claude (Opus 4.7) with a persistent conversation history and prompt caching.

Two tools are exposed:

- **`search_and_score_products`** — searches live or mock product data and returns up to 8 results scored 0–100 across price, discount, store reputation, stock, shipping, and payment methods.
- **`simulate_purchase`** — simulates a checkout. It is guarded: the agent checks the user's last message for explicit approval keywords before calling it. Purchases over $50,000 ARS require the user to also quote the exact amount.

The agent runs an internal loop (max 6 iterations per turn) to complete multi-step reasoning and tool calls before responding.

---

## Flow

**Supervised mode (default):**

1. User describes what they want.
2. Agent calls `search_and_score_products`, presents the 3 best options with scores and reasoning.
3. User explicitly approves ("dale", "sí", "confirmado").
4. Agent calls `simulate_purchase` and returns a mock receipt.

**Autonomous mode (watchlist):**

1. User provides a product list, a minimum discount threshold, and a total budget.
2. Agent interprets this as pre-authorization: searches every item, filters those that meet the threshold, and simulates purchases as long as the budget holds — no per-item approval needed.
3. Returns a full summary: what was bought, what was skipped, total spent, and total savings.

---

## Track

🤑 Agentic Money

## Team

- Barbara Olivera ([@barolivera](https://github.com/barolivera))
- Enzo Leonardo Cagliero ([@leocagli](https://github.com/leocagli))
- Fede Tavano ([@tavanofede-png](https://github.com/tavanofede-png))
- Steven Molina ([@StevenMolina22](https://github.com/StevenMolina22))
- Elisa Araya ([@mariaelisaaraya](https://github.com/mariaelisaaraya))
