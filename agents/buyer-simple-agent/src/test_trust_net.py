#!/usr/bin/env python3
"""
Test Trust Net integration: buy plan (if needed) and call list_agents.
Run: poetry run python -m src.test_trust_net
"""

import os
import sys

from dotenv import load_dotenv

load_dotenv()

TRUST_NET_PLAN_ID = os.getenv(
    "TRUST_NET_PLAN_ID",
    "111171385715053379363820285370903002263619322296632596378198131296828952605172",
)


def main():
    api_key = os.getenv("NVM_API_KEY") or os.getenv("NVM_BUYER_API_KEY", "")
    if not api_key:
        print("ERROR: Set NVM_API_KEY or NVM_BUYER_API_KEY in .env")
        sys.exit(1)

    from payments_py import Payments, PaymentOptions

    from . import trust_net

    payments = Payments.get_instance(
        PaymentOptions(
            nvm_api_key=api_key,
            environment=os.getenv("NVM_ENVIRONMENT", "sandbox"),
        )
    )

    print("1. Checking Trust Net plan balance...")
    try:
        balance = payments.plans.get_plan_balance(TRUST_NET_PLAN_ID)
        bal_val = balance.balance if hasattr(balance, "balance") else balance
        print(f"   Balance: {bal_val}")
    except Exception as e:
        print(f"   Balance check failed: {e}")
        bal_val = 0

    if bal_val == 0 or (hasattr(bal_val, "__int__") and int(bal_val) == 0):
        print("2. Buying Trust Net plan (order_plan)...")
        try:
            order = payments.plans.order_plan(TRUST_NET_PLAN_ID)
            print(f"   Order result: {order}")
        except Exception as e:
            print(f"   Order failed: {e}")
            print("   You may need USDC in your wallet or to subscribe via nevermined.app")
    else:
        print("2. Already have balance, skipping order.")

    print("3. Calling Trust Net list_agents...")
    result = trust_net.list_agents()
    if "error" in result:
        print(f"   ERROR: {result['error']}")
        sys.exit(1)
    agents = result.get("agents") or (result.get("items") if isinstance(result.get("items"), list) else result.get("raw"))
    if isinstance(agents, str):
        print(f"   Raw response: {agents[:500]}...")
    elif isinstance(agents, list):
        print(f"   Found {len(agents)} agents")
        for i, a in enumerate(agents[:5]):
            name = a.get("name", a.get("id", "?"))
            score = a.get("trust_score", "?")
            verified = "✓" if a.get("verified") else ""
            print(f"      {i+1}. {name} (score: {score}) {verified}")
    else:
        print(f"   Result: {result}")
    print("OK: Trust Net test passed.")


if __name__ == "__main__":
    main()
