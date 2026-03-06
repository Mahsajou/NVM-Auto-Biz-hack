import { List } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GroceryItem } from "@/api";

interface ShoppingListModuleProps {
  items: GroceryItem[];
}

export default function ShoppingListModule({ items }: ShoppingListModuleProps) {
  if (items.length === 0) return null;

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <List className="h-4 w-4 text-[var(--color-nvm-teal)]" />
          Shopping List
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {items.length} item{items.length !== 1 ? "s" : ""} to shop
        </p>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[200px]">
          <ul className="space-y-1.5 text-sm">
            {items.map((item, idx) => (
              <li key={idx} className="flex items-center gap-2 py-1">
                <span className="text-muted-foreground shrink-0">
                  {item.quantity}{item.unit !== "each" ? ` ${item.unit}` : "x"}
                </span>
                <span>{item.name}</span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
