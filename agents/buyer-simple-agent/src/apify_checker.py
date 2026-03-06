"""
Apify-based ecommerce availability checker.

Checks if items from a shopping list are carried by Amazon and Walmart.
Uses Apify actors to scrape search results. Does NOT make purchases.

Usage:
    from .apify_checker import check_amazon_availability

    results = check_amazon_availability(
        items=["organic milk", "whole wheat bread"],
        api_key="apify_api_xxx",
    )
"""

import os
from dataclasses import dataclass


@dataclass
class ProductInfo:
    """Single product from e-commerce scrape (image, url, name, price, rating)."""

    image: str | None
    url: str | None
    name: str
    price: str | None
    price_currency: str | None
    brand: str | None
    rating: float | None
    review_count: int | None
    store: str  # "amazon" | "walmart"


@dataclass
class ItemAvailability:
    """Result for a single item's availability check."""

    item_name: str
    found: bool
    store: str  # "amazon" | "walmart"
    product_count: int
    top_match: str | None  # title of first match if found
    error: str | None  # error message if check failed
    products: list[ProductInfo]  # full product details for display


# Actor: apify/e-commerce-scraping-tool (keyword, marketplaces, scrapeMode input)
DEFAULT_ACTOR_ID = "apify/e-commerce-scraping-tool"


def _parse_product(raw: dict) -> ProductInfo:
    """Parse Apify e-commerce-scraping-tool output into ProductInfo."""
    url = raw.get("url") or ""
    store = "walmart" if "walmart" in url.lower() else "amazon"
    offers = raw.get("offers") or {}
    price = offers.get("price") if isinstance(offers.get("price"), str) else None
    brand_obj = raw.get("brand") or {}
    brand = brand_obj.get("slogan") if isinstance(brand_obj, dict) else None
    addl = raw.get("additionalProperties") or {}
    rating = addl.get("averageRating") if isinstance(addl.get("averageRating"), (int, float)) else None
    review_count = addl.get("numberOfReviews") if isinstance(addl.get("numberOfReviews"), int) else None
    return ProductInfo(
        image=raw.get("image"),
        url=url or None,
        name=raw.get("name") or raw.get("title") or "Unknown",
        price=price,
        price_currency=offers.get("priceCurrency") if isinstance(offers, dict) else None,
        brand=brand,
        rating=float(rating) if rating is not None else None,
        review_count=review_count,
        store=store,
    )


def _build_actor_input(keyword: str) -> dict:
    """Build the Apify actor input with keyword from the search form."""
    return {
        "additionalProperties": True,
        "additionalPropertiesSearchEngine": True,
        "additionalReviewProperties": True,
        "keyword": keyword,
        "marketplaces": [
            "www.amazon.com",
            "www.walmart.com",
        ],
        "scrapeInfluencerProducts": False,
        "scrapeReviewsDelivery": False,
        "scrapeMode": "AUTO",
        "countryCode": "us",
        "sortReview": "Most recent",
        "maxProductResults": 10,
    }


def check_amazon_availability(
    items: list[str],
    api_key: str | None = None,
    max_items_per_search: int = 5,
) -> list[ItemAvailability]:
    """
    Check if each item is available on Amazon/Walmart via Apify actor.

    Args:
        items: List of product names (e.g. ["organic milk", "whole wheat bread"])
        api_key: Apify API token. Defaults to APIFY_API_KEY env var.
        max_items_per_search: Max products to return per item (default 5).

    Returns:
        List of ItemAvailability, one per input item.
    """
    token = api_key or os.getenv("APIFY_API_KEY", "")
    if not token:
        return [
            ItemAvailability(
                item_name=item,
                found=False,
                store="amazon",
                product_count=0,
                top_match=None,
                error="APIFY_API_KEY not configured",
                products=[],
            )
            for item in items
        ]

    try:
        from apify_client import ApifyClient
    except ImportError:
        return [
            ItemAvailability(
                item_name=item,
                found=False,
                store="amazon",
                product_count=0,
                top_match=None,
                error="apify-client not installed",
                products=[],
            )
            for item in items
        ]

    client = ApifyClient(token=token)
    actor_id = os.getenv("APIFY_ACTOR_ID", DEFAULT_ACTOR_ID)
    results: list[ItemAvailability] = []

    for item_name in items:
        try:
            search_term = item_name.strip()
            if not search_term:
                results.append(
                    ItemAvailability(
                        item_name=item_name,
                        found=False,
                        store="amazon",
                        product_count=0,
                        top_match=None,
                        error="Empty item name",
                        products=[],
                    )
                )
                continue

            # Build actor input: keyword format (NOT startUrls)
            run_input = _build_actor_input(search_term)
            # Must NOT use: startUrls, maxItems — use keyword, marketplaces instead

            # Apify call: actor.call(run_input=dict)
            run = client.actor(actor_id).call(run_input=run_input)
            dataset = client.dataset(run["defaultDatasetId"])
            items_data = list(dataset.iterate_items())

            if not items_data:
                results.append(
                    ItemAvailability(
                        item_name=item_name,
                        found=False,
                        store="amazon",
                        product_count=0,
                        top_match=None,
                        error=None,
                        products=[],
                    )
                )
                continue

            # Parse products from e-commerce-scraping-tool output
            products = [_parse_product(p) for p in items_data if isinstance(p, dict)]
            first = products[0] if products else None
            title = first.name if first else None

            results.append(
                ItemAvailability(
                    item_name=item_name,
                    found=True,
                    store="amazon",
                    product_count=len(products),
                    top_match=title,
                    error=None,
                    products=products,
                )
            )
        except Exception as e:
            results.append(
                ItemAvailability(
                    item_name=item_name,
                    found=False,
                    store="amazon",
                    product_count=0,
                    top_match=None,
                    error=str(e),
                    products=[],
                )
            )

    return results
