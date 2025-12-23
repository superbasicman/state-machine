import { useState } from "react";
import Icon from "./Icon.jsx";

export default function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (event) => {
    event.stopPropagation();
    const content = typeof text === "string" ? text : JSON.stringify(text, null, 2);
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleCopy} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-subtle transition-colors">
      <Icon name={copied ? "check" : "copy"} className="w-4 h-4" />
    </button>
  );
}
