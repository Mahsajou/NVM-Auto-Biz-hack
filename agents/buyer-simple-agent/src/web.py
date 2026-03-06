"""
Web server for the buyer agent with chat UI support.

Provides a FastAPI server with:
- POST /api/chat — SSE streaming chat with the Strands agent
- GET /api/sellers — List registered sellers
- GET /api/balance — Check credit balance and budget
- GET /api/logs/stream — SSE log stream
- A2A registration routes (same as registration_server.py)
- Static file serving for the React frontend

Usage:
    poetry run web
"""

import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from strands.models.openai import OpenAIModel

from .log import enable_web_logging, get_logger, log
from .registration_server import RegistrationExecutor, _build_buyer_agent_card
from .strands_agent import (
    NVM_AGENT_ID,
    NVM_PLAN_ID,
    SELLER_URL,
    budget,
    create_agent,
    payments,
    seller_registry,
)
from .tools.balance import check_balance_impl
from .grocery_parser import parse_grocery_list, GroceryItem
from .tools.purchase import purchase_data_impl
from .prompta_leads import get_leads
from .reviews_seller import get_reviews

try:
    from . import platon_memory
    _PLATON_AVAILABLE = True
except ImportError as e:
    _PLATON_AVAILABLE = False
    _PLATON_IMPORT_ERROR = str(e)

try:
    from .apify_checker import check_amazon_availability
    _APIFY_AVAILABLE = True
except ImportError as e:
    _APIFY_AVAILABLE = False
    _APIFY_IMPORT_ERROR = str(e)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
BUYER_PORT = int(os.getenv("BUYER_PORT", "8000"))

if not OPENAI_API_KEY:
    print("OPENAI_API_KEY is required. Set it in .env file.")
    sys.exit(1)

# Create agent with no console callback handler for web mode
model = OpenAIModel(
    client_args={"api_key": OPENAI_API_KEY},
    model_id=os.getenv("MODEL_ID", "gpt-4o-mini"),
)
agent = create_agent(model, mode=os.getenv("BUYER_AGENT_MODE", "a2a"))

# Serialize concurrent chat requests (Strands Agent is not thread-safe)
agent_lock = asyncio.Lock()

# Log broadcast: each SSE subscriber gets its own queue
log_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
_log_subscribers: set[asyncio.Queue] = set()
_log_history: list[dict] = []  # recent logs for new subscribers
_LOG_HISTORY_MAX = 200


async def _log_dispatcher():
    """Read from the single log_queue and fan out to all subscribers."""
    while True:
        entry = await log_queue.get()
        _log_history.append(entry)
        if len(_log_history) > _LOG_HISTORY_MAX:
            _log_history.pop(0)
        dead = []
        for q in _log_subscribers:
            try:
                q.put_nowait(entry)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            _log_subscribers.discard(q)


_logger = get_logger("buyer.web")

app = FastAPI(title="Buyer Agent Web")


@app.on_event("startup")
async def _start_log_dispatcher():
    asyncio.create_task(_log_dispatcher())


# CORS for frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enable web log streaming
enable_web_logging(log_queue)


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


@app.post("/api/chat")
async def chat(request: Request):
    """Stream a chat response from the agent via SSE."""
    try:
        body = await request.json()
    except Exception as exc:
        log(_logger, "WEB", "ERROR", f"Failed to parse JSON body: {exc}")
        raw = (await request.body()).decode("utf-8", errors="replace")
        log(_logger, "WEB", "ERROR", f"Raw body: {raw[:200]}")
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    log(_logger, "WEB", "DEBUG", f"body keys={list(body.keys())}")
    message = (body.get("message", "") or body.get("prompt", "")).strip()
    if not message:
        log(_logger, "WEB", "ERROR", f"Empty message. Full body: {str(body)[:200]}")
        return JSONResponse({"error": "Empty message"}, status_code=400)

    log(_logger, "WEB", "RECEIVED", f'chat message: "{message[:80]}"')

    async def event_generator():
        full_response = ""
        try:
            async with agent_lock:
                async for event in agent.stream_async(message):
                    if "data" in event:
                        chunk = event["data"]
                        full_response += chunk
                        yield {
                            "event": "token",
                            "data": json.dumps({"text": chunk}),
                        }
                    elif "current_tool_use" in event:
                        tool_info = event["current_tool_use"]
                        tool_name = tool_info.get("name", "unknown")
                        yield {
                            "event": "tool_use",
                            "data": json.dumps({"name": tool_name}),
                        }
            yield {
                "event": "done",
                "data": json.dumps({"text": full_response}),
            }
        except Exception as exc:
            log(_logger, "WEB", "ERROR", f"chat stream error: {exc}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(exc)}),
            }

    return EventSourceResponse(event_generator())


@app.get("/api/sellers")
async def get_sellers():
    """Return all registered sellers."""
    return JSONResponse(content=seller_registry.list_all())


@app.get("/api/balance")
async def get_balance():
    """Check credit balance and budget status. Tracks API calls to sellers and services."""
    balance_result = check_balance_impl(payments, NVM_PLAN_ID)
    budget_status = budget.get_status()
    # Optionally include Trust Net (USDC) balance
    trustnet_balance = None
    if _TRUST_NET_AVAILABLE:
        try:
            trustnet_result = check_balance_impl(payments, trust_net.TRUST_NET_USDC_PLAN_ID)
            trustnet_balance = trustnet_result.get("balance", 0)
        except Exception:
            pass
    return JSONResponse(content={
        "balance": balance_result,
        "budget": budget_status,
        "trustnet_balance": trustnet_balance,
    })


@app.get("/ping")
async def ping():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/logs/stream")
async def log_stream(request: Request):
    """Stream log entries via SSE (broadcast to each subscriber)."""
    sub_queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    _log_subscribers.add(sub_queue)

    async def event_generator():
        try:
            # Replay history so new connections see past events
            for entry in _log_history:
                yield {"event": "log", "data": json.dumps(entry)}
            # Stream live events
            while True:
                if await request.is_disconnected():
                    break
                try:
                    entry = await asyncio.wait_for(sub_queue.get(), timeout=15.0)
                    yield {"event": "log", "data": json.dumps(entry)}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": ""}
        finally:
            _log_subscribers.discard(sub_queue)

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# Grocery shopping endpoints (no LLM — direct x402 purchase flow)
# ---------------------------------------------------------------------------

_grocery_session: dict = {"active": False, "items": [], "results": []}
_grocery_reviews: list[dict] = []
_context_saves: list[dict] = []  # Platon dump_session successes for Context Tool tab


def _get_seller_name_and_url() -> tuple[str, str]:
    """Get seller name and URL from registry or fallback to SELLER_URL."""
    sellers = seller_registry.list_all()
    base = SELLER_URL.rstrip("/")
    for s in sellers:
        if s["url"].rstrip("/") == base:
            return s["name"], s["url"]
    return "Grocery Seller", SELLER_URL


@app.post("/api/grocery/parse")
async def grocery_parse(request: Request):
    """Parse a grocery list from text or file upload.

    Accepts JSON body {"text": "..."} or multipart file upload.
    Returns parsed items ready for shopping.
    """
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        if not upload:
            return JSONResponse({"error": "No file uploaded"}, status_code=400)
        raw = (await upload.read()).decode("utf-8", errors="replace")
    else:
        body = await request.json()
        raw = body.get("text", "")

    if not raw.strip():
        return JSONResponse({"error": "Empty grocery list"}, status_code=400)

    items = parse_grocery_list(raw)
    if not items:
        return JSONResponse({"error": "No items found in the list"}, status_code=400)

    log(_logger, "GROCERY", "PARSED", f"{len(items)} items from upload")
    return JSONResponse({
        "items": [item.to_dict() for item in items],
        "count": len(items),
    })


@app.post("/api/grocery/shop")
async def grocery_shop(request: Request):
    """Shop a grocery list item-by-item via x402. Streams progress via SSE.

    Accepts {"items": [...]} where each item has name, quantity, unit.
    No LLM needed — calls purchase_data_impl() directly.
    """
    body = await request.json()
    raw_items = body.get("items", [])
    if not raw_items:
        return JSONResponse({"error": "No items to shop"}, status_code=400)

    items = [
        GroceryItem(
            name=it["name"],
            quantity=float(it.get("quantity", 1)),
            unit=it.get("unit", "each"),
            raw_line=it.get("raw_line", it["name"]),
        )
        for it in raw_items
    ]

    log(_logger, "GROCERY", "SHOP", f"starting shop for {len(items)} items")
    _grocery_session.update(active=True, items=raw_items, results=[])

    session_id = f"session-{datetime.now(timezone.utc).strftime('%Y-%m-%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"
    item_names = [it.to_query() for it in items]

    # Platon: retrieve context before task (optional; continue if unavailable)
    if _PLATON_AVAILABLE:
        try:
            ctx = await asyncio.to_thread(
                platon_memory.retrieve_context,
                f"Grocery shopping: {len(items)} items — {', '.join(item_names[:5])}{'...' if len(item_names) > 5 else ''}",
                limit=5,
                payments=payments,
            )
            if ctx.get("error"):
                log(_logger, "PLATON", "RETRIEVE", ctx["error"])
            else:
                log(_logger, "PLATON", "RETRIEVE", "context loaded")
        except Exception as e:
            log(_logger, "PLATON", "RETRIEVE", str(e))

    async def event_generator():
        total_credits = 0
        purchased, skipped, failed = 0, 0, 0
        errors: list[str] = []

        for idx, item in enumerate(items):
            yield {
                "event": "item_start",
                "data": json.dumps({
                    "index": idx,
                    "total": len(items),
                    "item": item.to_dict(),
                }),
            }

            allowed, reason = budget.can_spend(1)
            if not allowed:
                skipped += 1
                entry = {"item": item.to_dict(), "status": "skipped", "reason": reason}
                _grocery_session["results"].append(entry)
                yield {
                    "event": "item_done",
                    "data": json.dumps({"index": idx, **entry}),
                }
                continue

            result = await asyncio.to_thread(
                purchase_data_impl,
                payments=payments,
                plan_id=NVM_PLAN_ID,
                seller_url=SELLER_URL,
                query=item.to_query(),
                agent_id=NVM_AGENT_ID,
            )

            if result.get("status") == "success":
                credits = result.get("credits_used", 1)
                budget.record_purchase(credits, SELLER_URL, item.to_query())
                total_credits += credits
                purchased += 1
                entry = {
                    "item": item.to_dict(),
                    "status": "purchased",
                    "credits": credits,
                    "response": result.get("response", "")[:200],
                }
            else:
                failed += 1
                error_text = ""
                if result.get("content"):
                    error_text = result["content"][0]["text"][:200]
                errors.append(f"{item.name}: {error_text}")
                entry = {
                    "item": item.to_dict(),
                    "status": "failed",
                    "error": error_text,
                }

            _grocery_session["results"].append(entry)
            yield {
                "event": "item_done",
                "data": json.dumps({"index": idx, **entry}),
            }

        _grocery_session["active"] = False
        seller_name, seller_url = _get_seller_name_and_url()
        done_payload = {
            "purchased": purchased,
            "skipped": skipped,
            "failed": failed,
            "total_credits": total_credits,
            "budget": budget.get_status(),
            "seller_name": seller_name,
            "seller_url": seller_url,
            "results": _grocery_session["results"],
        }
        yield {
            "event": "shopping_done",
            "data": json.dumps(done_payload),
        }

        # Platon: dump session after task (always, including failed/partial)
        if _PLATON_AVAILABLE:
            try:
                outcome_status = "success" if failed == 0 else ("partial" if purchased > 0 else "failed")
                dump_result = await asyncio.to_thread(
                    platon_memory.dump_session,
                    session_id=session_id,
                    task={
                        "kind": "grocery-shopping",
                        "summary": f"Shop {len(items)} items: {', '.join(item_names[:5])}{'...' if len(item_names) > 5 else ''}",
                    },
                    outcome={
                        "status": outcome_status,
                        "summary": f"Purchased {purchased}, skipped {skipped}, failed {failed}. Total credits: {total_credits}.",
                    },
                    tools=["purchase_data_impl", "budget"],
                    events=[{"type": "shopping_done", "purchased": purchased, "failed": failed}],
                    errors=errors if errors else None,
                    artifacts=[{"kind": "results", "summary": f"{purchased} purchased, {failed} failed"}],
                    payments=payments,
                )
                if dump_result.get("status") == "saved":
                    entry = {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "session_id": session_id,
                        "task": "grocery-shopping",
                        "outcome": outcome_status,
                    }
                    _context_saves.append(entry)
                    log(_logger, "PLATON", "DUMP", f"context saved: {session_id}")
                    yield {
                        "event": "context_saved",
                        "data": json.dumps(entry),
                    }
                else:
                    log(_logger, "PLATON", "DUMP", dump_result.get("error", "unknown"))
            except Exception as e:
                log(_logger, "PLATON", "DUMP", str(e))

    return EventSourceResponse(event_generator())


@app.get("/api/grocery/status")
async def grocery_status():
    """Return the current grocery shopping session state."""
    return JSONResponse({
        "active": _grocery_session["active"],
        "items_total": len(_grocery_session["items"]),
        "items_processed": len(_grocery_session["results"]),
        "results": _grocery_session["results"],
    })


@app.post("/api/grocery/review")
async def grocery_review(request: Request):
    """Submit a rating and review for a seller."""
    body = await request.json()
    seller_url = body.get("seller_url", "")
    seller_name = body.get("seller_name", "Grocery Seller")
    rating = body.get("rating", 0)
    review = body.get("review", "")

    if not seller_url or not (1 <= rating <= 5):
        return JSONResponse({"error": "seller_url and rating (1-5) required"}, status_code=400)

    entry = {
        "seller_url": seller_url,
        "seller_name": seller_name,
        "rating": rating,
        "review": review,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    _grocery_reviews.append(entry)
    log(_logger, "GROCERY", "REVIEW", f"seller={seller_name} rating={rating}")
    return JSONResponse({"status": "ok", "review": entry})


@app.get("/api/grocery/reviews")
async def grocery_reviews():
    """Return all submitted reviews."""
    return JSONResponse({"reviews": _grocery_reviews})


# ---------------------------------------------------------------------------
# Prompta — lead generation (find customers with grocery shopping needs)
# ---------------------------------------------------------------------------


@app.post("/api/leads/get")
async def leads_get():
    """Fetch leads from Prompta marketing agent — users with grocery shopping needs."""
    log(_logger, "LEADS", "FETCH", "calling Prompta agent")
    result = await asyncio.to_thread(get_leads, payments)
    return JSONResponse(result)


# ---------------------------------------------------------------------------
# Shop Mate Seller Reviews — purchase review data from reviews seller agent
# ---------------------------------------------------------------------------


@app.post("/api/reviews/purchase")
async def reviews_purchase(request: Request):
    """Purchase reviews from the Shop Mate Seller Reviews agent."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    query = (body.get("query") or "").strip()
    log(_logger, "REVIEWS", "PURCHASE", f"calling reviews seller (query={query[:50] if query else 'default'}...)")
    result = await asyncio.to_thread(get_reviews, payments, query)
    return JSONResponse(result)


# ---------------------------------------------------------------------------
# Platon — persistent context (memory.retrieve_context, memory.dump_session)
# ---------------------------------------------------------------------------


@app.get("/api/platon/context-saves")
async def platon_context_saves():
    """Return recent Platon context save events (Context Tool tab)."""
    return JSONResponse({"saves": _context_saves})


# ---------------------------------------------------------------------------
# Apify ecommerce availability check ("Check if Amazon carry it")
# ---------------------------------------------------------------------------


@app.post("/api/grocery/check-availability")
async def check_availability(request: Request):
    """Check if items from a shopping list are carried by Amazon.

    Accepts {"items": ["item1", "item2", ...]} — product names to search.
    Returns availability results per item. Does NOT make purchases.
    """
    if not _APIFY_AVAILABLE:
        return JSONResponse(
            {"error": f"Apify not available: {_APIFY_IMPORT_ERROR}. Run: poetry add apify-client"},
            status_code=503,
        )

    body = await request.json()
    raw_items = body.get("items", [])
    if not raw_items:
        return JSONResponse({"error": "No items to check"}, status_code=400)

    # Support both string list and object list (e.g. from GroceryItem)
    item_names = []
    for it in raw_items:
        if isinstance(it, str):
            item_names.append(it)
        elif isinstance(it, dict):
            item_names.append(it.get("name", it.get("raw_line", str(it))))
        else:
            item_names.append(str(it))

    log(_logger, "APIFY", "CHECK", f"checking {len(item_names)} items on Amazon")
    results = await asyncio.to_thread(
        check_amazon_availability,
        items=item_names,
        api_key=os.getenv("APIFY_API_KEY"),
        max_items_per_search=5,
    )

    return JSONResponse({
        "results": [
            {
                "item_name": r.item_name,
                "found": r.found,
                "store": r.store,
                "product_count": r.product_count,
                "top_match": r.top_match,
                "error": r.error,
                "products": [
                    {
                        "image": p.image,
                        "url": p.url,
                        "name": p.name,
                        "price": p.price,
                        "price_currency": p.price_currency,
                        "brand": p.brand,
                        "rating": p.rating,
                        "review_count": p.review_count,
                        "store": p.store,
                    }
                    for p in r.products
                ],
            }
            for r in results
        ],
    })


# ---------------------------------------------------------------------------
# Trust Net — rank and verify sellers (x402 + USDC)
# ---------------------------------------------------------------------------

try:
    from . import trust_net
    _TRUST_NET_AVAILABLE = True
except ImportError as e:
    _TRUST_NET_AVAILABLE = False
    _TRUST_NET_IMPORT_ERROR = str(e)


@app.get("/api/trustnet/agents")
async def trustnet_list_agents():
    """List vetted agents from Trust Net (trust score, reviews, verified status)."""
    if not _TRUST_NET_AVAILABLE:
        return JSONResponse(
            {"error": f"Trust Net not available: {_TRUST_NET_IMPORT_ERROR}"},
            status_code=503,
        )
    result = await asyncio.to_thread(trust_net.list_agents)
    return JSONResponse(result)


@app.get("/api/trustnet/reviews")
async def trustnet_get_reviews(agent_id: str = ""):
    """Get community reviews for an agent. Query param: agent_id."""
    if not _TRUST_NET_AVAILABLE:
        return JSONResponse(
            {"error": f"Trust Net not available: {_TRUST_NET_IMPORT_ERROR}"},
            status_code=503,
        )
    if not agent_id:
        return JSONResponse({"error": "agent_id query param required"}, status_code=400)
    result = await asyncio.to_thread(trust_net.get_reviews, agent_id)
    return JSONResponse(result)


@app.post("/api/trustnet/review")
async def trustnet_submit_review(request: Request):
    """Submit a review for an agent (requires verification tx)."""
    if not _TRUST_NET_AVAILABLE:
        return JSONResponse(
            {"error": f"Trust Net not available: {_TRUST_NET_IMPORT_ERROR}"},
            status_code=503,
        )
    body = await request.json()
    agent_id = body.get("agent_id", "")
    reviewer_address = body.get("reviewer_address", "")
    verification_tx = body.get("verification_tx", "")
    score = int(body.get("score", 0))
    comment = body.get("comment", "")

    if not all([agent_id, reviewer_address, verification_tx, comment]):
        return JSONResponse(
            {"error": "agent_id, reviewer_address, verification_tx, comment required"},
            status_code=400,
        )
    if not (1 <= score <= 10):
        return JSONResponse({"error": "score must be 1-10"}, status_code=400)

    result = await asyncio.to_thread(
        trust_net.submit_review,
        agent_id,
        reviewer_address,
        verification_tx,
        score,
        comment,
    )
    return JSONResponse(result)


# ---------------------------------------------------------------------------
# A2A registration routes
# ---------------------------------------------------------------------------

# A2A registration routes (always mounted so sellers can register)
from a2a.server.apps import A2AFastAPIApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore

executor = RegistrationExecutor(seller_registry)
agent_card = _build_buyer_agent_card(BUYER_PORT)
task_store = InMemoryTaskStore()
handler = DefaultRequestHandler(
    agent_executor=executor,
    task_store=task_store,
)
a2a_app = A2AFastAPIApplication(
    agent_card=agent_card,
    http_handler=handler,
)
a2a_app.add_routes_to_app(app)


@app.get("/")
async def root():
    """API only — no UI. Use http://localhost:5173 for the frontend."""
    return JSONResponse({
        "message": "API server. Use http://localhost:5173 for the UI.",
        "docs": "/api/sellers, /api/chat, /api/grocery/*, /api/trustnet/*",
    })


def main():
    """Run the buyer agent API server (no UI). Use localhost:5173 for the frontend."""
    import uvicorn

    log(_logger, "WEB", "STARTUP", f"port={BUYER_PORT} mode=a2a")
    print(f"API server running on http://localhost:{BUYER_PORT}")
    print(f"  API: /api/chat, /api/sellers, /api/grocery/*, /api/trustnet/*")
    print(f"A2A registration endpoint active")
    print(f"  Frontend: http://localhost:5173 (run: cd frontend && npm run dev)")

    uvicorn.run(app, host="0.0.0.0", port=BUYER_PORT, log_level="warning")


if __name__ == "__main__":
    main()
