"""Parse grocery list text into structured items.

Handles common list formats:
    - "2 lbs apples"
    - "1 gallon milk"
    - "bread" (no quantity -> defaults to 1)
    - "3x eggs"
    - Lines starting with -, *, or numbered (1.)
"""

import re
from dataclasses import dataclass, asdict


@dataclass
class GroceryItem:
    name: str
    quantity: float
    unit: str
    raw_line: str

    def to_dict(self) -> dict:
        return asdict(self)

    def to_query(self) -> str:
        """Format as a purchase query for the seller agent."""
        if self.unit == "each":
            qty = int(self.quantity) if self.quantity == int(self.quantity) else self.quantity
            return f"Buy grocery item: {qty} {self.name}"
        qty = int(self.quantity) if self.quantity == int(self.quantity) else self.quantity
        return f"Buy grocery item: {qty} {self.unit} {self.name}"


_UNITS = {
    "lb", "lbs", "pound", "pounds",
    "oz", "ounce", "ounces",
    "kg", "kilogram", "kilograms", "g", "gram", "grams",
    "gallon", "gallons", "gal",
    "liter", "liters", "l", "ml",
    "cup", "cups",
    "dozen", "doz",
    "bunch", "bunches",
    "bag", "bags",
    "box", "boxes",
    "can", "cans",
    "bottle", "bottles",
    "jar", "jars",
    "pack", "packs", "package", "packages",
    "loaf", "loaves",
    "head", "heads",
    "block", "blocks",
    "stick", "sticks",
    "slice", "slices",
    "piece", "pieces", "pcs",
    "carton", "cartons",
    "container", "containers",
    "roll", "rolls",
}

_LIST_PREFIX = re.compile(r"^(?:[-*•]\s*|\d+[.)]\s*)")
_QTY_UNIT_NAME = re.compile(
    r"^(\d+(?:\.\d+)?)\s*x?\s+(" + "|".join(sorted(_UNITS, key=len, reverse=True)) + r")\s+(.+)$",
    re.IGNORECASE,
)
_QTY_NAME = re.compile(r"^(\d+(?:\.\d+)?)\s*x?\s+(.+)$")


def parse_line(line: str) -> GroceryItem | None:
    """Parse a single line into a GroceryItem, or None if the line is empty/comment."""
    raw = line.strip()
    if not raw or raw.startswith("#"):
        return None

    cleaned = _LIST_PREFIX.sub("", raw).strip()
    if not cleaned:
        return None

    # Try: quantity + unit + name  (e.g. "2 lbs apples")
    m = _QTY_UNIT_NAME.match(cleaned)
    if m:
        return GroceryItem(
            name=m.group(3).strip(),
            quantity=float(m.group(1)),
            unit=m.group(2).lower(),
            raw_line=raw,
        )

    # Try: quantity + name  (e.g. "3 bananas", "6x eggs")
    m = _QTY_NAME.match(cleaned)
    if m:
        return GroceryItem(
            name=m.group(2).strip(),
            quantity=float(m.group(1)),
            unit="each",
            raw_line=raw,
        )

    # Bare name (e.g. "bread")
    return GroceryItem(name=cleaned, quantity=1, unit="each", raw_line=raw)


def parse_grocery_list(text: str) -> list[GroceryItem]:
    """Parse multi-line grocery list text into a list of GroceryItems."""
    items = []
    for line in text.splitlines():
        item = parse_line(line)
        if item:
            items.append(item)
    return items


def parse_grocery_file(path: str) -> list[GroceryItem]:
    """Read a file and parse it as a grocery list."""
    with open(path, "r") as f:
        return parse_grocery_list(f.read())
