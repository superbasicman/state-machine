import { useMemo, useState } from "react";
import { Bot } from "lucide-react";

export default function TextInteraction({ interaction, onSubmit, disabled }) {
  const { prompt, question, placeholder, validation } = interaction;
  const [text, setText] = useState("");
  const [error, setError] = useState(null);

  const rules = useMemo(() => validation || {}, [validation]);

  const validate = (value) => {
    if (rules.minLength && value.length < rules.minLength) {
      return `Minimum ${rules.minLength} characters required`;
    }
    if (rules.maxLength && value.length > rules.maxLength) {
      return `Maximum ${rules.maxLength} characters allowed`;
    }
    if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
      return "Invalid format";
    }
    return null;
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    const err = validate(trimmed);
    if (err) {
      setError(err);
      return;
    }
    onSubmit({ text: trimmed, raw: trimmed });
  };

  return (
    <div className="w-full h-full flex flex-col items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-12 space-y-8 flex flex-col items-center">
        <div className="space-y-4 shrink-0">
          <div className="w-16 h-16 rounded-3xl bg-black text-white dark:bg-white dark:text-black flex items-center justify-center mx-auto shadow-2xl shadow-black/20 dark:shadow-white/10">
            <Bot className="w-8 h-8" />
          </div>
          <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-fg pt-4 text-center">Action required.</h3>
        </div>

        <div className="w-full max-w-2xl space-y-4">
          <div className="text-lg sm:text-xl font-medium text-fg/70 text-center whitespace-pre-wrap break-words">
            {prompt || question || "Provide your response."}
          </div>
          <textarea
            value={text}
            onChange={(event) => { setText(event.target.value); setError(null); }}
            disabled={disabled}
            placeholder={placeholder || "Your response..."}
            className={`w-full h-64 p-8 rounded-[32px] bg-black/[0.02] dark:bg-white/[0.03] border-2 ${
              error ? "border-black dark:border-white" : "border-transparent"
            } focus:border-black dark:focus:border-white focus:outline-none text-xl sm:text-2xl font-medium transition-all text-center placeholder:opacity-20`}
          />
          {error && <div className="text-black dark:text-white text-center text-sm font-semibold">{error}</div>}
        </div>
      </div>

      <div className="p-4 flex justify-center bg-gradient-to-t from-bg via-bg to-transparent shrink-0 border-t border-black/10 dark:border-white/10">
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="px-12 py-6 bg-fg text-bg rounded-full font-bold text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-2xl"
        >
          Submit Response
        </button>
      </div>
    </div>
  );
}
