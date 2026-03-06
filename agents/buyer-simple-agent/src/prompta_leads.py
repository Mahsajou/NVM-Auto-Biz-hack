"""
Prompta lead generation — find customers/leads with grocery shopping needs.

Calls the Prompta marketing seller agent to find users who need grocery
shopping services. Uses x402 payment protocol.

When PROMPTA_SELLER_URL is not set, fetches the agent endpoint from the
Nevermined API (payments.agents.get_agent).
"""

import os

from .tools.purchase import purchase_data_impl

# Prompta marketing service
PROMPTA_PLAN_ID = os.getenv(
    "PROMPTA_PLAN_ID",
    "75487548881585806765891238817506375815024719766032068317736664462463369221318",
)
PROMPTA_AGENT_ID = os.getenv(
    "PROMPTA_AGENT_ID",
    "28744455506253719439355309070854035710561167109692836172020876792102066260600",
)
PROMPTA_SELLER_URL = os.getenv(
    "PROMPTA_SELLER_URL",
    "",
)
PROMPTA_ENDPOINT_PATH = os.getenv("PROMPTA_ENDPOINT_PATH", "/data")

# Nevermined checkout URL for subscribing to Prompta
PROMPTA_CHECKOUT_URL = (
    "https://nevermined.app/checkout/28744455506253719439355309070854035710561167109692836172020876792102066260600"
)


def _resolve_prompta_url(payments) -> tuple[str, str]:
    """Resolve Prompta seller URL and path. Returns (base_url, path) or raises."""
    url = PROMPTA_SELLER_URL.strip()
    if url:
        base = url.rstrip("/")
        path = PROMPTA_ENDPOINT_PATH
        return base, path

    # Fetch agent from Nevermined API to get endpoint
    try:
        agent = payments.agents.get_agent(PROMPTA_AGENT_ID)
    except Exception as e:
        raise ValueError(
            f"Could not fetch Prompta agent from Nevermined. "
            f"Set PROMPTA_SELLER_URL in .env or subscribe at {PROMPTA_CHECKOUT_URL}. Error: {e}"
        ) from e

    endpoints = agent.get("endpoints") or []
    for ep in endpoints:
        if isinstance(ep, dict):
            post_url = ep.get("POST") or ep.get("post") or ep.get("url")
            if post_url and isinstance(post_url, str):
                # Replace :agentId placeholder if present
                resolved = post_url.replace(":agentId", PROMPTA_AGENT_ID)
                # Split into base URL and path
                if "/" in resolved:
                    parts = resolved.split("/", 3)
                    if len(parts) >= 4 and parts[0].startswith("http"):
                        base = f"{parts[0]}//{parts[2]}"
                        path = "/" + parts[3] if len(parts) > 3 else "/"
                        return base.rstrip("/"), path
                return resolved.rstrip("/"), ""
        elif isinstance(ep, str) and ep.upper() == "POST":
            continue

    # Fallback: try Nevermined proxy pattern
    base = "https://proxy.nevermined.app"
    path = f"/agents/{PROMPTA_AGENT_ID}/data"
    return base, path


def get_leads(payments) -> dict:
    """Fetch leads from Prompta — users with grocery/shopping list needs.

    Args:
        payments: Payments SDK instance.

    Returns:
        dict with status, content/response, credits_used, or error.
    """
    try:
        base_url, path = _resolve_prompta_url(payments)
    except ValueError as e:
        return {
            "status": "error",
            "content": [{"text": str(e)}],
            "credits_used": 0,
        }

    # Build full endpoint: if path is full URL, use it; else append path to base
    if path.startswith("http"):
        endpoint_base = path.rsplit("/", 1)[0] if "/" in path else path
        endpoint_path = ""
    elif path:
        endpoint_base = base_url
        endpoint_path = path if path.startswith("/") else f"/{path}"
    else:
        endpoint_base = base_url
        endpoint_path = PROMPTA_ENDPOINT_PATH

    seller_url = f"{endpoint_base}{endpoint_path}" if endpoint_path else endpoint_base

    query = (
        "Find and list exactly 10 customers or leads who have grocery shopping needs "
        "or shopping lists and would use a grocery shopping assistant service like Shop Mate. "
        "For each lead provide: name, contact (email or phone), and a brief note about their grocery needs. "
        "Format as a numbered list (1. Name - contact - note, 2. ...) or JSON array."
    )

    return purchase_data_impl(
        payments=payments,
        plan_id=PROMPTA_PLAN_ID,
        seller_url=seller_url.rstrip("/"),
        query=query,
        agent_id=PROMPTA_AGENT_ID,
        path="",  # Full URL already includes path
    )
