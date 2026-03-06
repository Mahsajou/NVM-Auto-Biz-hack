"""
Scripted x402 grocery buyer — step-by-step payment flow without LLM.

Reads a grocery list from a text file, then for each item:
1. Check budget allowance
2. Generate x402 access token
3. POST to seller with payment-signature header
4. Record purchase in budget tracker

Usage:
    # First start the seller: cd ../seller-simple-agent && poetry run agent
    # Then run the grocery client:
    poetry run grocery-client                          # uses grocery_list.txt
    poetry run grocery-client --file my_list.txt       # custom file
    poetry run grocery-client --text "2 lbs apples, 1 gallon milk"
"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from payments_py import Payments, PaymentOptions

from .grocery_parser import parse_grocery_list, parse_grocery_file, GroceryItem
from .tools.discover import discover_pricing_impl
from .tools.balance import check_balance_impl
from .tools.purchase import purchase_data_impl
from .budget import Budget

SELLER_URL = os.getenv("SELLER_URL", "http://localhost:3000")
NVM_API_KEY = os.getenv("NVM_API_KEY", "")
NVM_ENVIRONMENT = os.getenv("NVM_ENVIRONMENT", "sandbox")
NVM_PLAN_ID = os.getenv("NVM_PLAN_ID", "")
NVM_AGENT_ID = os.getenv("NVM_AGENT_ID")
MAX_DAILY = int(os.getenv("MAX_DAILY_SPEND", "100"))
MAX_PER_REQ = int(os.getenv("MAX_PER_REQUEST", "10"))

DEFAULT_LIST = Path(__file__).parent.parent / "grocery_list.txt"


def pretty_json(obj: dict) -> str:
    return json.dumps(obj, indent=2)


def print_step(number: int, title: str):
    print(f"\n{'=' * 60}")
    print(f"STEP {number}: {title}")
    print("=" * 60)


def print_result(result: dict):
    print(f"\nStatus: {result['status']}")
    if result.get("content"):
        print(result["content"][0]["text"])


def print_item_row(idx: int, total: int, item: GroceryItem, status: str, credits: int = 0):
    tag = f"[{idx}/{total}]"
    if status == "ok":
        print(f"  {tag} ✓ {item.raw_line:<35} ({credits} credits)")
    elif status == "skip":
        print(f"  {tag} ⊘ {item.raw_line:<35} (budget limit)")
    else:
        print(f"  {tag} ✗ {item.raw_line:<35} (failed)")


def load_items(args: argparse.Namespace) -> list[GroceryItem]:
    if args.text:
        text = args.text.replace(",", "\n")
        return parse_grocery_list(text)

    path = args.file or str(DEFAULT_LIST)
    if not Path(path).exists():
        print(f"File not found: {path}")
        sys.exit(1)
    return parse_grocery_file(path)


def main():
    parser = argparse.ArgumentParser(description="Grocery x402 buyer (no LLM)")
    parser.add_argument("--file", "-f", help="Path to grocery list file")
    parser.add_argument("--text", "-t", help="Inline grocery list (comma-separated)")
    args = parser.parse_args()

    if not NVM_API_KEY or not NVM_PLAN_ID:
        print("NVM_API_KEY and NVM_PLAN_ID are required. Set them in .env")
        sys.exit(1)

    payments = Payments.get_instance(
        PaymentOptions(nvm_api_key=NVM_API_KEY, environment=NVM_ENVIRONMENT)
    )
    budget = Budget(max_daily=MAX_DAILY, max_per_request=MAX_PER_REQ)

    print("=" * 60)
    print("x402 Grocery Buyer — Shopping Flow")
    print("=" * 60)
    print(f"Seller:  {SELLER_URL}")
    print(f"Plan ID: {NVM_PLAN_ID}")

    # --- Step 1: Parse grocery list ---
    print_step(1, "Parse grocery list")
    items = load_items(args)
    if not items:
        print("No items found in the grocery list.")
        sys.exit(1)
    print(f"\nFound {len(items)} items:")
    for i, item in enumerate(items, 1):
        print(f"  {i}. {item.quantity} {item.unit} {item.name}")

    # --- Step 2: Discover seller pricing ---
    print_step(2, "Discover seller pricing tiers")
    print_result(discover_pricing_impl(SELLER_URL))

    # --- Step 3: Check balance ---
    print_step(3, "Check credit balance")
    balance_result = check_balance_impl(payments, NVM_PLAN_ID)
    print_result(balance_result)

    # --- Step 4: Shop each item ---
    print_step(4, f"Shop {len(items)} grocery items")
    results = {"purchased": [], "skipped": [], "failed": []}
    total_credits = 0

    for idx, item in enumerate(items, 1):
        query = item.to_query()

        allowed, reason = budget.can_spend(1)
        if not allowed:
            print_item_row(idx, len(items), item, "skip")
            results["skipped"].append({"item": item.raw_line, "reason": reason})
            continue

        result = purchase_data_impl(
            payments=payments,
            plan_id=NVM_PLAN_ID,
            seller_url=SELLER_URL,
            query=query,
            agent_id=NVM_AGENT_ID,
        )

        if result.get("status") == "success":
            credits = result.get("credits_used", 1)
            budget.record_purchase(credits, SELLER_URL, query)
            total_credits += credits
            print_item_row(idx, len(items), item, "ok", credits)
            results["purchased"].append({"item": item.raw_line, "credits": credits})
        else:
            print_item_row(idx, len(items), item, "fail")
            error_msg = ""
            if result.get("content"):
                error_msg = result["content"][0]["text"][:100]
            results["failed"].append({"item": item.raw_line, "error": error_msg})

    # --- Step 5: Shopping summary ---
    print_step(5, "Shopping summary")
    print(f"\n  Items purchased:  {len(results['purchased'])}")
    print(f"  Items skipped:    {len(results['skipped'])}")
    print(f"  Items failed:     {len(results['failed'])}")
    print(f"  Total credits:    {total_credits}")
    print(f"\nBudget status:")
    print(f"  {pretty_json(budget.get_status())}")

    print(f"\n{'=' * 60}")
    print("GROCERY SHOPPING COMPLETE!")
    print("=" * 60)
    print(
        """
x402 Grocery Buyer Flow Summary:
1. Parsed grocery list           -> Extracted items with quantities
2. GET  /pricing                 -> Discovered seller pricing tiers
3. Checked NVM balance           -> Credit balance and subscriber status
4. POST /data (per item)         -> Purchased each grocery item via x402
5. Reviewed budget               -> Daily spend tracking
"""
    )


if __name__ == "__main__":
    main()
