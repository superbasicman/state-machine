import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";

export default function InteractionForm({ interaction, onSubmit, disabled }) {
  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const lastSlugRef = useRef(interaction.slug);

  useEffect(() => {
    if (lastSlugRef.current !== interaction.slug) {
      setResponse("");
      lastSlugRef.current = interaction.slug;
    }
  }, [interaction.slug]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!response.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(interaction.slug, interaction.targetKey, response.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full h-full flex flex-col items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-12 md:py-24 space-y-12 flex flex-col items-center">
        <div className="space-y-4 shrink-0">
          <div className="w-16 h-16 rounded-3xl bg-accent text-white flex items-center justify-center mx-auto shadow-2xl shadow-accent/40">
            <Bot className="w-8 h-8" />
          </div>
          <h3 className="text-4xl font-extrabold tracking-tight text-fg pt-4 text-center">Action required.</h3>
        </div>

        <div className="w-full max-w-2xl space-y-8 pb-12">
          <div className="text-2xl font-semibold tracking-tight text-fg text-center italic">
            {interaction.question || "Provide your response."}
          </div>
          <textarea
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            disabled={disabled || submitting}
            placeholder="Your response..."
            className="w-full h-64 p-8 rounded-[32px] bg-black/[0.03] dark:bg-white/[0.03] border-none focus:ring-4 focus:ring-accent/10 focus:outline-none text-2xl font-medium transition-all text-center placeholder:opacity-20"
          />
        </div>
      </div>

      <div className="p-4 flex justify-center bg-gradient-to-t from-bg via-bg to-transparent backdrop-blur-lg shrink-0 border-t border-white/5">
        <button
          type="submit"
          disabled={disabled || submitting || !response.trim()}
          className="px-12 py-6 bg-fg text-bg rounded-full font-bold text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-2xl"
        >
          {submitting ? "Sending..." : "Submit Response"}
        </button>
      </div>
    </form>
  );
}
