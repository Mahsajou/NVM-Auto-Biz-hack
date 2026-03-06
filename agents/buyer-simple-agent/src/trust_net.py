"""
Trust Net integration — rank and verify sellers via Nevermined x402 + USDC.

Calls Trust Net MCP tools:
- list_agents: Get vetted agents with trust score, reviews, verified status
- get_reviews: Get community reviews for an agent
- submit_review: Submit a review (requires on-chain verification tx)

Uses USDC Plan ID and x402 payment protocol.
"""

import json
import os
import uuid

import httpx

from payments_py import Payments, PaymentOptions
from payments_py.x402.types import X402TokenOptions

TRUST_NET_MCP_URL = "https://trust-net-mcp.rikenshah-02.workers.dev/mcp"

# USDC Plan ID for Trust Net
TRUST_NET_USDC_PLAN_ID = os.getenv(
    "TRUST_NET_PLAN_ID",
    "111171385715053379363820285370903002263619322296632596378198131296828952605172",
)


def _get_payments() -> Payments:
    """Get Payments instance for Trust Net (uses NVM_API_KEY)."""
    api_key = os.getenv("NVM_API_KEY") or os.getenv("NVM_BUYER_API_KEY", "")
    env = os.getenv("NVM_ENVIRONMENT", "sandbox")
    return Payments.get_instance(
        PaymentOptions(nvm_api_key=api_key, environment=env)
    )


def _get_x402_token(payments: Payments, plan_id: str, agent_id: str = "") -> str | None:
    """Get a fresh x402 access token for a single call. USDC plan."""
    try:
        # Try with default options first (SDK resolves scheme from plan)
        token_result = payments.x402.get_x402_access_token(
            plan_id=plan_id,
            agent_id=agent_id or None,
        )
        return token_result.get("accessToken")
    except Exception:
        try:
            token_options = X402TokenOptions(scheme="nvm:credits")
            token_result = payments.x402.get_x402_access_token(
                plan_id=plan_id,
                agent_id=agent_id or None,
                token_options=token_options,
            )
            return token_result.get("accessToken")
        except Exception:
            return None


def _call_mcp_tool(tool_name: str, arguments: dict | None = None) -> dict:
    """Call a Trust Net MCP tool with x402 payment."""
    payments = _get_payments()
    token = _get_x402_token(payments, TRUST_NET_USDC_PLAN_ID)
    if not token:
        return {"error": "Failed to get x402 access token. Check NVM_API_KEY and plan subscription."}

    base_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {token}",
        "payment-signature": token,
    }

    try:
        with httpx.Client(timeout=90.0) as client:
            # 1. Initialize MCP (required for Authorization)
            init_resp = client.post(
                TRUST_NET_MCP_URL,
                headers=base_headers,
                json={
                    "jsonrpc": "2.0",
                    "id": str(uuid.uuid4()),
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "trust-net-client", "version": "1.0.0"},
                    },
                },
            )
            if init_resp.status_code != 200:
                body = init_resp.text[:500] if init_resp.text else ""
                return {"error": f"Trust Net init failed: HTTP {init_resp.status_code} {body}"}

            # 2. Call the tool (session optional — Trust Net may not return mcp-session-id)
            session_id = init_resp.headers.get("mcp-session-id") or init_resp.headers.get("Mcp-Session-Id")
            tool_headers = {**base_headers}
            if session_id:
                tool_headers["Mcp-Session-Id"] = session_id

            payload = {
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments or {},
                },
            }
            response = client.post(TRUST_NET_MCP_URL, headers=tool_headers, json=payload)

        if response.status_code == 402:
            return {"error": "Payment required (402). Insufficient credits or not subscribed to Trust Net USDC plan."}

        if response.status_code != 200:
            return {"error": f"Trust Net returned HTTP {response.status_code}: {response.text[:500]}"}

        # Parse response (may be JSON or SSE)
        text = response.text or ""
        if text.strip().startswith("event:"):
            # SSE format: extract JSON from data: line
            for line in text.split("\n"):
                if line.startswith("data:"):
                    try:
                        data = json.loads(line[5:].strip())
                        break
                    except json.JSONDecodeError:
                        continue
            else:
                return {"error": "Trust Net: could not parse SSE response"}
        else:
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                return {"error": f"Trust Net: invalid response {text[:200]}"}
        if "error" in data:
            return {"error": data["error"].get("message", str(data["error"]))}

        result = data.get("result", {})
        content = result.get("content", [])
        if content and isinstance(content[0], dict):
            text = content[0].get("text", "")
            try:
                parsed = json.loads(text) if text.strip().startswith("{") else {"raw": text}
                # Trust Net returns "items"; normalize to "agents" for frontend
                if isinstance(parsed, dict) and "items" in parsed and "agents" not in parsed:
                    agents = []
                    for it in parsed.get("items", []):
                        a = dict(it)
                        a["id"] = a.get("agent_id") or a.get("id")
                        a["trust_score"] = float(a["trust_score"]) if a.get("trust_score") else None
                        a["verified"] = (a.get("tier") or "").lower() in ("platinum", "gold")
                        a["reviews"] = a.get("review_count", 0)
                        agents.append(a)
                    parsed["agents"] = agents
                return parsed
            except json.JSONDecodeError:
                return {"raw": text}
        return result

    except httpx.ConnectError:
        return {"error": "Cannot connect to Trust Net. Check network."}
    except Exception as e:
        return {"error": str(e)}


def list_agents() -> dict:
    """List all vetted agents with trust score, star rating, reviews, price, verified status.

    Returns agents sorted by trust score (highest first). Highlights verified agents.
    """
    return _call_mcp_tool("list_agents", {})


def get_reviews(agent_id: str) -> dict:
    """Get all community reviews for an agent.

    Args:
        agent_id: Agent ID from list_agents output.
    """
    return _call_mcp_tool("get_reviews", {"agent_id": agent_id})


def submit_review(
    agent_id: str,
    reviewer_address: str,
    verification_tx: str,
    score: int,
    comment: str,
) -> dict:
    """Submit a review for an agent.

    Args:
        agent_id: From list_agents.
        reviewer_address: Your Ethereum wallet address (0x...).
        verification_tx: On-chain transaction hash proving ownership (real tx required).
        score: Integer 1–10.
        comment: Short review text.
    """
    return _call_mcp_tool("submit_review", {
        "agent_id": agent_id,
        "reviewer_address": reviewer_address,
        "verification_tx": verification_tx,
        "score": score,
        "comment": comment,
    })
