import { useState, useRef } from "react";
import { Upload, ShoppingCart, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GroceryItem } from "@/api";

interface GroceryUploadProps {
  onItemsParsed: (items: GroceryItem[]) => void;
  onParseError: (error: string) => void;
  disabled?: boolean;
}

export default function GroceryUpload({
  onItemsParsed,
  onParseError,
  disabled,
}: GroceryUploadProps) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const content = await file.text();
    setText(content);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleParse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    try {
      const { parseGroceryText } = await import("@/api");
      const items = await parseGroceryText(text);
      onItemsParsed(items);
    } catch (err) {
      onParseError(err instanceof Error ? err.message : "Failed to parse");
    } finally {
      setParsing(false);
    }
  };

  const clearFile = () => {
    setFileName("");
    setText("");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingCart className="h-5 w-5 text-[var(--color-nvm-teal)]" />
          Shopping List
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Paste your grocery list or upload a text file, then shop with Shop Mate.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="relative border-2 border-dashed rounded-xl p-6 text-center transition-colors hover:border-[var(--color-nvm-teal)] hover:bg-[var(--color-nvm-teal)]/5 cursor-pointer"
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,.md,.text"
            onChange={handleFileInput}
            className="hidden"
          />
          {fileName ? (
            <div className="flex items-center justify-center gap-2">
              <FileText className="h-5 w-5 text-[var(--color-nvm-teal)]" />
              <span className="text-sm font-medium">{fileName}</span>
              <button
                onClick={(e) => { e.stopPropagation(); clearFile(); }}
                className="ml-1 p-0.5 rounded-full hover:bg-muted"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drop a text file here or click to browse
              </p>
            </>
          )}
        </div>

        {/* Text area */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "Or type your grocery list here...\n\n2 lbs apples\n1 gallon milk\n1 loaf bread\n6 eggs\n3 bananas"
          }
          rows={8}
          disabled={disabled}
          className="w-full resize-none rounded-xl border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono leading-relaxed"
        />

        {/* Parse + Shop button */}
        <div className="flex justify-end">
          <Button
            onClick={handleParse}
            disabled={!text.trim() || parsing || disabled}
            className="rounded-xl bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] hover:opacity-90 border-0 shadow-md text-white gap-2 px-6"
          >
            <ShoppingCart className="h-4 w-4" />
            {parsing ? "Parsing..." : "Parse & Shop"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
