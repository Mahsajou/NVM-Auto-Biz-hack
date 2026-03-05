# Workshop: Getting Started with Nevermined — Library Setup & SDKs

**Duration:** 45-60 minutes
**Goal:** Participants install the SDK, initialize the Payments object, protect an endpoint with x402 middleware, and test the full payment flow as both builder and subscriber.

---

## Format Recommendation

| Element | Recommendation |
|---------|----------------|
| **Slides** | Use the Keynote in this folder (`Library Setup - Getting Started.key`) |
| **Live demo** | Primary format — code along with participants |
| **Terminal** | Two terminals: one for server, one for client |
| **Browser** | nevermined.app for API key + plan creation |

**Why code-along:** This is the foundation workshop. Participants need to type the code themselves to build muscle memory for the SDK patterns they'll use in every other workshop.

---

## Pre-Workshop Checklist

### Your machine (presenter)

- [ ] Python 3.10+ and Poetry installed
- [ ] Node.js 18+ and npm/yarn installed
- [ ] Valid `NVM_API_KEY` (sandbox) — get from https://nevermined.app
- [ ] `NVM_PLAN_ID` set (create a plan via the app or `setup.py`)
- [ ] `.env` file ready with all variables
- [ ] Workshop files tested: `python setup.py`, `python server.py`, `python client.py`
- [ ] Terminal font size large enough for projection (24pt+)

### Participant machines

- [ ] Python 3.10+ or Node.js 18+
- [ ] Nevermined account created at https://nevermined.app
- [ ] Sandbox API key generated

---

## Agenda

| Time | Section | Format | Files |
|------|---------|--------|-------|
| 0:00 - 0:05 | What is Nevermined + x402 overview | Slides | — |
| 0:05 - 0:10 | SDK installation + initialization | Live code | `setup.py` / `setup.ts` |
| 0:10 - 0:20 | Protected server with middleware | Live code | `server.py` / `server.ts` |
| 0:20 - 0:30 | x402 client flow (402 → token → 200) | Live code | `client.py` / `client.ts` |
| 0:30 - 0:40 | Manual verification (no middleware) | Live code | `server_manual.py` / `server-manual.ts` |
| 0:40 - 0:50 | Testing end-to-end + nevermined.app dashboard | Demo | — |
| 0:50 - 1:00 | Q&A | Open | — |

---

## Detailed Script

### Section 1: What is Nevermined (5 min)

**Key points to cover:**

> "Nevermined is payment infrastructure for AI agents. At its core is the x402 protocol — an HTTP-native payment flow. A client sends a request, the server returns 402 with payment requirements, the client gets a token from Nevermined and retries. The server verifies the token, executes your logic, and settles credits on-chain."

Show the simplified flow:

```
Client → POST /ask (no token)
Server → 402 + payment-required header
Client → get_x402_access_token() from Nevermined
Client → POST /ask + payment-signature header
Server → verify → execute → settle → 200 + payment-response
```

> "Three headers power the entire protocol: `payment-signature`, `payment-required`, `payment-response`. The middleware handles all of this for you."

---

### Section 2: SDK Initialization (5 min)

**Open `python/setup.py`**

> "Everything starts with the Payments object. One initialization call — your API key and the environment."

```python
payments = Payments.get_instance(
    PaymentOptions(
        nvm_api_key=os.getenv("NVM_API_KEY", ""),
        environment=os.getenv("NVM_ENVIRONMENT", "sandbox"),
    )
)
```

**Key talking points:**
- Sandbox keys start with `sandbox:`, live keys with `live:`
- The Payments object has sub-modules: `plans`, `agents`, `x402`, `facilitator`, `mcp`, `a2a`, `observability`
- TypeScript is identical — show `ts/setup.ts` side by side

**Run it:**
```bash
python setup.py
# → "Connected as: 0x..."
```

---

### Section 3: Protected Server (10 min)

**Open `python/server.py`**

> "Protecting an endpoint is literally one middleware line."

```python
app.add_middleware(
    PaymentMiddleware,
    payments=payments,
    routes={"POST /ask": {"plan_id": PLAN_ID, "credits": 1}},
)
```

**Key talking points:**
- The route map defines which endpoints are protected and how much they cost
- Your handler (`@app.post("/ask")`) only executes if payment is valid
- The middleware automatically returns 402 with `payment-required` header when no token is present
- Show the TypeScript equivalent (`ts/server.ts`) — same pattern with Express

**Run the server:**
```bash
python server.py
# → "Protected server running on http://localhost:3000"
```

**Test without payment:**
```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "What is AI?"}' -v
```

> "See the 402 response? Look at the `payment-required` header — it tells the client exactly what to pay."

---

### Section 4: Client Flow (10 min)

**Open `python/client.py`**

> "The client flow has three steps: try without token, get a token, retry with the token."

Walk through each step:

1. **Step 1: Request without token → 402**
   ```python
   res1 = client.post(f"{SERVER_URL}/ask", json={"query": "What is AI?"})
   # → 402
   ```

2. **Step 2: Get x402 access token**
   ```python
   token_result = payments.x402.get_x402_access_token(PLAN_ID)
   access_token = token_result["accessToken"]
   ```
   > "Note: `get_x402_access_token` returns a dict — you need `["accessToken"]`. In TypeScript it's destructured: `const { accessToken } = await payments.x402.getX402AccessToken(PLAN_ID)`."

3. **Step 3: Request with token → 200**
   ```python
   res2 = client.post(
       f"{SERVER_URL}/ask",
       headers={"payment-signature": access_token},
       json={"query": "What is AI?"},
   )
   # → 200 OK
   ```

**Run the client (second terminal):**
```bash
python client.py
# Step 1: 402
# Step 2: Token obtained (xxx chars)
# Step 3: 200 {'answer': 'Result for: What is AI?'}
```

---

### Section 5: Manual Verification (10 min)

**Open `python/server_manual.py`**

> "The middleware is convenient, but sometimes you need full control. Here's the 3-step flow under the hood."

Walk through the three steps:

1. **Build payment requirements** — `build_payment_required(plan_id, endpoint, agent_id, http_verb)`
2. **Verify** (read-only, no credits burned) — `payments.facilitator.verify_permissions(...)`
3. **Settle** (burns credits on-chain) — `payments.facilitator.settle_permissions(...)`

> "Verify is safe to call multiple times — it's a read-only check. Settle is the write operation that burns credits."

**When to use manual vs middleware:**
- Middleware: 95% of cases — one line, done
- Manual: custom error handling, conditional execution, partial refunds, or when you need to do something between verify and settle

---

### Section 6: Testing End-to-End (10 min)

**Demo flow:**

1. Start server: `python server.py`
2. Run client: `python client.py`
3. Show the 402 → token → 200 flow in terminal output
4. Open nevermined.app and show:
   - The plan's credit balance decreasing
   - Transaction history for the agent

> "Every credit burn is an on-chain transaction on Base L2 — about $0.0001 per settlement. Fully transparent, fully auditable."

---

## Troubleshooting Notes (for presenter)

| Issue | Fix |
|-------|-----|
| `payments-py` install fails | Try `pip install payments-py` (no extras needed for basic x402) |
| 402 but can't get token | Check `NVM_API_KEY` is valid sandbox key; check `NVM_PLAN_ID` matches a real plan |
| Token works but settlement fails | Subscriber needs to have ordered the plan first (`order_plan`) |
| Port 3000 in use | Use `PORT=3001` or kill existing process |
| TypeScript import errors | Ensure `@nevermined-io/payments` version >= 1.1.5 |

---

## Backup Plan

If live coding fails:
1. **Walk through the files** — open each `.py` / `.ts` and explain the code
2. **Pre-run the server** — have it running before the workshop starts
3. **Show terminal output screenshots** — pre-captured 402 → 200 flow
