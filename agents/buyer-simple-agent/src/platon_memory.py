"""
Platon persistent memory integration for the buying agent.

Uses Platon MCP at https://platon.bigf.me/mcp (not HTTP API).
Follows https://platon.bigf.me/agent-installation.md:
- Stable agentKind and agentId across runs
- memory.retrieve_context before tasks
- memory.get_similar_failures on errors
- memory.dump_session after every task (including failed/partial)
"""

import json
import os
import uuid

import httpx

from payments_py import Payments

PLATON_MCP_URL = "https://platon.bigf.me/mcp"
AGENT_KIND = "buying-agent"
AGENT_ID = os.getenv("PLATON_AGENT_ID", "shop-mate-01")


def _get_token(payments: Payments | None = None) -> str | None:
    """Get x402 token for Platon. Uses PLATON_PLAN_ID or NVM_PLAN_ID."""
    plan_id = os.getenv("PLATON_PLAN_ID") or os.getenv("NVM_PLAN_ID", "")
    agent_id = os.getenv("PLATON_AGENT_ID") or os.getenv("NVM_AGENT_ID", "")
    if not plan_id:
        return None
    pay = payments
    if pay is None:
        from payments_py import PaymentOptions
        api_key = os.getenv("NVM_API_KEY") or os.getenv("NVM_BUYER_API_KEY", "")
        env = os.getenv("NVM_ENVIRONMENT", "sandbox")
        pay = Payments.get_instance(PaymentOptions(nvm_api_key=api_key, environment=env))
    try:
        result = pay.x402.get_x402_access_token(
            plan_id=plan_id,
            agent_id=agent_id or None,
        )
        return result.get("accessToken")
    except Exception:
        return None


def _call_mcp_tool(tool_name: str, arguments: dict, payments: Payments | None = None) -> dict:
    """Call a Platon MCP tool with x402 payment."""
    token = _get_token(payments)
    if not token:
        return {"error": "No x402 token. Set PLATON_PLAN_ID and subscribe."}

    base_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "payment-signature": token,
    }

    try:
        with httpx.Client(timeout=60.0) as client:
            # 1. Initialize MCP session
            init_resp = client.post(
                PLATON_MCP_URL,
                headers=base_headers,
                json={
                    "jsonrpc": "2.0",
                    "id": str(uuid.uuid4()),
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "platon-buyer-agent", "version": "1.0.0"},
                    },
                },
            )
            if init_resp.status_code == 402:
                return {"error": "Payment required. Subscribe to Platon plan."}
            if init_resp.status_code != 200:
                body = init_resp.text[:500] if init_resp.text else ""
                return {"error": f"Platon init failed: HTTP {init_resp.status_code} {body}"}

            session_id = init_resp.headers.get("mcp-session-id") or init_resp.headers.get("Mcp-Session-Id")
            if not session_id:
                return {"error": "Platon init: no mcp-session-id in response"}

            # 2. Call the tool
            tool_headers = {**base_headers, "Mcp-Session-Id": session_id}
            payload = {
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments,
                },
            }
            response = client.post(PLATON_MCP_URL, headers=tool_headers, json=payload)

        if response.status_code == 402:
            return {"error": "Payment required. Subscribe to Platon plan."}
        if response.status_code != 200:
            return {"error": f"Platon {tool_name} failed: HTTP {response.status_code} {response.text[:300]}"}

        text = response.text or ""
        if text.strip().startswith("event:"):
            for line in text.split("\n"):
                if line.startswith("data:"):
                    try:
                        data = json.loads(line[5:].strip())
                        break
                    except json.JSONDecodeError:
                        continue
            else:
                return {"error": "Platon: could not parse SSE response"}
        else:
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                return {"error": f"Platon: invalid response {text[:200]}"}

        if "error" in data:
            return {"error": data["error"].get("message", str(data["error"]))}

        result = data.get("result", {})
        content = result.get("content", [])
        if content and isinstance(content[0], dict):
            text = content[0].get("text", "")
            if text.strip().startswith("{"):
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    pass
            return {"raw": text}
        return result

    except httpx.ConnectError:
        return {"error": "Platon unavailable. Continue and record in next dump."}
    except Exception as e:
        return {"error": str(e)}


def retrieve_context(query: str, limit: int = 5, payments: Payments | None = None) -> dict:
    """Retrieve relevant context before a task. Call before each new task."""
    return _call_mcp_tool(
        "memory.retrieve_context",
        {
            "agentKind": AGENT_KIND,
            "agentId": AGENT_ID,
            "query": query,
            "limit": limit,
        },
        payments=payments,
    )


def get_similar_failures(description: str, limit: int = 3, payments: Payments | None = None) -> dict:
    """Retrieve similar past failures. Call when handling errors or risky steps."""
    return _call_mcp_tool(
        "memory.get_similar_failures",
        {
            "agentKind": AGENT_KIND,
            "agentId": AGENT_ID,
            "description": description,
            "limit": limit,
        },
        payments=payments,
    )


def dump_session(
    session_id: str,
    task: dict,
    outcome: dict,
    tools: list[str] | None = None,
    events: list[dict] | None = None,
    errors: list[str] | None = None,
    artifacts: list[dict] | None = None,
    payments: Payments | None = None,
) -> dict:
    """Dump session after every task. Always record failed and partial runs."""
    arguments: dict = {
        "agentKind": AGENT_KIND,
        "agentId": AGENT_ID,
        "sessionId": session_id,
        "task": task,
        "outcome": outcome,
    }
    if tools:
        arguments["tools"] = tools
    if events:
        arguments["events"] = events
    if errors:
        arguments["errors"] = errors
    if artifacts:
        arguments["artifacts"] = artifacts

    result = _call_mcp_tool("memory.dump_session", arguments, payments=payments)
    if "error" in result:
        return result
    return {"status": "saved", "sessionId": session_id}
