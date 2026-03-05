# Workshop: Nevermined x A2A — Agent-to-Agent Payments

**Duration:** 45-60 minutes
**Goal:** Participants build a seller agent with an Agent Card and payment extension, then build a buyer agent that discovers the seller, subscribes, and sends paid messages via the A2A protocol.

---

## Format Recommendation

| Element | Recommendation |
|---------|----------------|
| **Slides** | Minimal — use diagrams for the A2A flow |
| **Live demo** | Primary format — run seller + buyer side by side |
| **Terminal** | Three terminals: seller, buyer, and curl for Agent Card inspection |
| **Browser** | nevermined.app for balance tracking |

**Why live demo:** A2A is about two agents talking to each other. Seeing seller and buyer running simultaneously is far more impactful than slides.

---

## Pre-Workshop Checklist

### Your machine (presenter)

- [ ] `payments-py` installed with A2A support (`pip install payments-py`)
- [ ] Two Nevermined accounts:
  - **Builder account**: `NVM_API_KEY` for the seller
  - **Subscriber account**: separate `NVM_API_KEY` for the buyer
- [ ] `NVM_PLAN_ID` and `NVM_AGENT_ID` set (registered via app or SDK)
- [ ] All workshop files tested: seller starts, buyer discovers and communicates
- [ ] Port 8000 free for the seller agent

### Participant machines

- [ ] Python 3.10+ or Node.js 18+
- [ ] Two Nevermined sandbox accounts (or pair up: one builds seller, partner builds buyer)

---

## Agenda

| Time | Section | Format | Files |
|------|---------|--------|-------|
| 0:00 - 0:05 | What is A2A + why payments? | Slides | — |
| 0:05 - 0:10 | A2A architecture with Nevermined | Diagram | — |
| 0:10 - 0:25 | Building the seller agent | Live code | `seller.py` / `seller.ts` |
| 0:25 - 0:40 | Building the buyer agent | Live code | `buyer.py` / `buyer.ts` |
| 0:40 - 0:55 | Running both + end-to-end demo | Live demo | — |
| 0:55 - 1:00 | Q&A | Open | — |

---

## Detailed Script

### Section 1: What is A2A (5 min)

**Key talking points:**

> "A2A is Google's open protocol for multi-agent systems. JSON-RPC for messaging, SSE for streaming, Agent Cards for discovery. What it doesn't have is payments — that's where Nevermined comes in."

> "With Nevermined, your Agent Card advertises both what your agent can do AND how much it costs. Payment validation happens at the message level, credits settle at task completion."

---

### Section 2: Architecture (5 min)

Draw or show this architecture:

```
Buyer Agent                        Seller Agent
    |                                   |
    |  1. GET /.well-known/agent.json   |
    |---------------------------------->|  (Agent Card + payment extension)
    |                                   |
    |  2. order_plan(planId)            |
    |         (to Nevermined)           |
    |                                   |
    |  3. JSON-RPC message              |
    |  + payment-signature header       |
    |---------------------------------->|
    |                                   |  PaymentsRequestHandler:
    |                                   |  → verify x402 token
    |                                   |  → call executor
    |                                   |  → settle credits
    |  4. SSE events                    |
    |<----------------------------------|  (final event: creditsUsed)
```

**Key difference from HTTP:**
- HTTP: payment per request, middleware on endpoints
- A2A: payment per message, settlement per task, tools are plain functions

---

### Section 3: Building the Seller (15 min)

**Open `python/seller.py`**

Walk through the three parts:

#### Part 1: The Executor

> "The Executor is your business logic. It receives the message and emits events."

```python
class MyExecutor:
    async def execute(self, context, event_queue):
        query = context.message.parts[0].text
        tool = "research" if "research" in query.lower() else "search"
        credits_used = CREDIT_MAP.get(tool, 1)

        await event_queue.enqueue_event({
            "status": {"state": "completed"},
            "final": True,
            "metadata": {"creditsUsed": str(credits_used)},
        })
```

> "IMPORTANT: the final event must include `creditsUsed` in metadata — that's what triggers settlement. It's a plain dict, not a typed class."

> "Also important: tools in A2A mode are plain functions. No `@requires_payment` decorator. Payment validation happens at the message level via the handler."

#### Part 2: The Agent Card

```python
agent_card = build_payment_agent_card(
    base_card={"name": "Data Seller", "url": f"http://localhost:{PORT}", ...},
    plan_id=PLAN_ID,
    agent_id=AGENT_ID,
    default_credits=1,
)
```

> "The Agent Card is your storefront. It tells buyers: here's what I do (skills) and here's what I charge (payment extension)."

#### Part 3: The Handler

```python
handler = PaymentsRequestHandler(payments, agent_card, 1, MyExecutor())
```

> "One line. The handler validates x402 tokens before calling your executor. If the token is invalid, `execute()` is never called."

**Show TypeScript equivalent (`ts/seller.ts`):**
- Same Executor pattern but with typed interfaces (`AgentExecutor`, `RequestContext`, `ExecutionEventBus`)
- `TaskStatusUpdateEvent` is a typed object in TS (vs plain dict in Python)
- `payments.a2a.start(...)` to launch the server

---

### Section 4: Building the Buyer (15 min)

**Open `python/buyer.py`**

Walk through the 5 steps:

1. **Discover**: `GET /.well-known/agent.json`
   ```python
   card = httpx.get(f"{SELLER_URL}/.well-known/agent.json").json()
   ```

2. **Parse payment extension**: Extract `planId` and `agentId`
   ```python
   payment_ext = card["extensions"][0]["params"]
   plan_id = payment_ext["planId"]
   ```

3. **Subscribe**: `payments.plans.order_plan(plan_id)`

4. **Get token**: `payments.x402.get_x402_access_token(plan_id, agent_id)`

5. **Send paid message**:
   ```python
   client = PaymentsClient(url=SELLER_URL, payments=payments, ...)
   async for event in client.send_message_stream("Search for climate data"):
       if event.status.state == "completed":
           print(f"Credits used: {event.metadata.get('creditsUsed')}")
   ```

**Show TypeScript equivalent (`ts/buyer.ts`):**
- Uses `payments.a2a.getClient(...)` to create the A2A client
- Supports both `sendA2AMessage` (single response) and `sendA2AMessageStream` (SSE)
- Payment extension is at `card.capabilities.extensions` (different path than Python)

---

### Section 5: Running Both (15 min)

**Terminal 1 — Start the seller:**
```bash
python seller.py
# → Seller running on http://localhost:8000
# → Agent Card: http://localhost:8000/.well-known/agent.json
```

**Inspect the Agent Card:**
```bash
curl http://localhost:8000/.well-known/agent.json | python -m json.tool
```

> "See the payment extension? `planId`, `agentId`, `defaultCredits`. This is what the buyer discovers automatically."

**Terminal 2 — Run the buyer:**
```bash
python buyer.py
# → Discovered: Data Seller
# → Plan: did:nv:...
# → Event: ...
# → Credits used: 1
```

**Show in nevermined.app:**
- Buyer's credit balance decreased
- Transaction recorded in agent analytics

> "Two independent agents, talking to each other, with automatic payment. The seller doesn't need to know who the buyer is. The buyer doesn't need to know the pricing in advance. Discovery + payment, fully automated."

---

## Troubleshooting Notes (for presenter)

| Issue | Fix |
|-------|-----|
| Agent Card returns 404 | Check server is running; check URL includes correct path |
| `extensions` key missing | Check `build_payment_agent_card` includes plan_id and agent_id |
| Token verification fails | Buyer must use a subscriber key, not a builder key |
| `send_message_stream` hangs | Check seller's executor emits a `final: True` event |
| Credits not settling | Check `creditsUsed` is in the final event's metadata (as string in Python) |
| Port 8000 in use | Change `PORT` variable or kill existing process |

---

## Backup Plan

If the live two-agent demo fails:
1. **Walk through the code** — open seller.py and buyer.py side by side, explain the flow
2. **Use curl to simulate** — manually send JSON-RPC messages to the seller
3. **Focus on the Agent Card** — show the discovery pattern even without a running buyer
