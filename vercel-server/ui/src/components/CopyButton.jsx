import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({ text, label = "Copy", disabled = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (event) => {
    event.stopPropagation();
    if (disabled) return;
    const content = typeof text === "string" ? text : JSON.stringify(text, null, 2);
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={`tooltip p-2 rounded-full text-subtle transition-colors ${disabled ? "opacity-30 cursor-not-allowed" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
      data-tooltip={label}
      aria-label={label}
      disabled={disabled}
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}
