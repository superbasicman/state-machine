import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";

export default function InteractionForm({ interaction, onSubmit, disabled }) {
  const [response, setResponse] = useState(interaction.question || "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setResponse(interaction.question || "");
  }, [interaction]);

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
    <div className="w-full h-full flex flex-col items-center justify-center text-center space-y-12 px-6 overflow-y-auto custom-scroll">
      <div className="space-y-4 shrink-0">
        <div className="w-16 h-16 rounded-3xl bg-accent text-white flex items-center justify-center mx-auto shadow-2xl shadow-accent/40">
          <Icon name="bot" className="w-8 h-8" />
        </div>
        <h3 className="text-4xl font-extrabold tracking-tight text-fg pt-4">Action required.</h3>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-8 pb-12">
        <textarea
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          disabled={disabled || submitting}
          placeholder="Your response..."
          className="w-full h-48 p-8 rounded-[32px] bg-black/[0.03] dark:bg-white/[0.03] border-none focus:ring-4 focus:ring-accent/10 focus:outline-none text-2xl font-medium transition-all text-center placeholder:opacity-20"
        />
        <button
          type="submit"
          disabled={disabled || submitting || !response.trim()}
          className="px-12 py-6 bg-fg text-bg rounded-full font-bold text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-2xl"
        >
          {submitting ? "Sending..." : "Submit Response"}
        </button>
      </form>
    </div>
  );
}
