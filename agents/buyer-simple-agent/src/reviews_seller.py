"""
Shop Mate Seller Reviews — purchase review data from the reviews seller agent.

Calls the user's reviews seller agent to buy review data (reviews made for
sellers). Uses x402 payment protocol.
"""

import os

from .tools.purchase import purchase_data_impl

# Shop Mate Seller Reviews service
REVIEWS_PLAN_ID = os.getenv(
    "REVIEWS_PLAN_ID",
    "67475140880333701491089781943430116921269732275997393271096692356851482067458",
)
REVIEWS_AGENT_ID = os.getenv(
    "REVIEWS_AGENT_ID",
    "105770377365895420516068789314715951313306586166892856219570381354903905486817",
)
REVIEWS_SELLER_URL = os.getenv(
    "REVIEWS_SELLER_URL",
    "https://shopmate-seller-reviews",
)
REVIEWS_ENDPOINT_PATH = os.getenv("REVIEWS_ENDPOINT_PATH", "/data")


def get_reviews(payments, query: str = "") -> dict:
    """Fetch reviews from the Shop Mate Seller Reviews agent.

    Args:
        payments: Payments SDK instance.
        query: Optional query to filter or specify what reviews to fetch.
               Default asks for available reviews.

    Returns:
        dict with status, content/response, credits_used, or error.
    """
    url = REVIEWS_SELLER_URL.strip()
    if not url:
        return {
            "status": "error",
            "content": [{"text": "REVIEWS_SELLER_URL not configured. Set it in .env."}],
            "credits_used": 0,
        }

    q = query.strip() or (
        "Give me the seller reviews I have access to. "
        "List reviews I've made for sellers with seller name, rating, and review text."
    )
    return purchase_data_impl(
        payments=payments,
        plan_id=REVIEWS_PLAN_ID,
        seller_url=url.rstrip("/"),
        query=q,
        agent_id=REVIEWS_AGENT_ID,
        path=REVIEWS_ENDPOINT_PATH,
    )
