import { useMemo, useState } from "react";
import { Bot, Check } from "lucide-react";

export default function ChoiceInteraction({ interaction, onSubmit, disabled }) {
  const { prompt, question, options = [], multiSelect, allowCustom } = interaction;
  const [selected, setSelected] = useState(multiSelect ? [] : null);
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const list = useMemo(() => options || [], [options]);
  const title = prompt || question || "Choose an option.";

  const handleSelect = (key) => {
    if (multiSelect) {
      setSelected((prev) => (
        prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
      ));
      setShowCustom(false);
    } else {
      setSelected(key);
      setShowCustom(false);
    }
  };

  const handleSubmit = () => {
    if (showCustom && customText.trim()) {
      onSubmit({ isCustom: true, customText: customText.trim(), raw: customText.trim() });
      return;
    }
    if (multiSelect && selected.length > 0) {
      onSubmit({ selectedKeys: selected, raw: selected.join(", ") });
      return;
    }
    if (selected) {
      onSubmit({ selectedKey: selected, raw: String(selected) });
    }
  };

  const isValid = showCustom
    ? Boolean(customText.trim())
    : (multiSelect ? selected.length > 0 : Boolean(selected));

  return (
    <div className="w-full h-full flex flex-col items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-12 space-y-8 flex flex-col items-center">
        <div className="space-y-4 shrink-0">
          <div className="w-16 h-16 rounded-3xl bg-accent text-white flex items-center justify-center mx-auto shadow-2xl shadow-accent/40">
            <Bot className="w-8 h-8" />
          </div>
          <h3 className="text-4xl font-extrabold tracking-tight text-fg pt-4 text-center">Choose an option.</h3>
        </div>

        <div className="text-xl font-medium text-fg/70 text-center max-w-2xl whitespace-pre-wrap">
          {title}
        </div>

        <div className="w-full max-w-2xl space-y-3">
          {list.map((opt) => {
            const isSelected = multiSelect ? selected.includes(opt.key) : selected === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => handleSelect(opt.key)}
                disabled={disabled}
                type="button"
                className={`w-full p-6 rounded-2xl border-2 transition-all text-left ${
                  isSelected
                    ? "border-accent bg-accent/10"
                    : "border-white/10 hover:border-white/20 bg-black/[0.03] dark:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                    isSelected
                      ? "border-accent bg-accent text-white"
                      : "border-white/20"
                  }`}>
                    {isSelected && <Check className="w-4 h-4" />}
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-lg">{opt.label || opt.key}</div>
                    {opt.description && <div className="text-sm text-fg/50 mt-1">{opt.description}</div>}
                  </div>
                </div>
              </button>
            );
          })}

          {allowCustom && (
            <button
              onClick={() => { setShowCustom(true); setSelected(multiSelect ? [] : null); }}
              disabled={disabled}
              type="button"
              className={`w-full p-6 rounded-2xl border-2 transition-all text-left ${
                showCustom
                  ? "border-accent bg-accent/10"
                  : "border-white/10 hover:border-white/20 bg-black/[0.03] dark:bg-white/[0.03]"
              }`}
            >
              <div className="font-bold text-lg">Other</div>
              <div className="text-sm text-fg/50 mt-1">Provide a custom response</div>
            </button>
          )}

          {showCustom && (
            <textarea
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              placeholder="Type your response..."
              className="w-full h-32 p-6 rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border-2 border-accent/30 focus:border-accent focus:outline-none text-lg"
            />
          )}
        </div>
      </div>

      <div className="p-4 flex justify-center bg-gradient-to-t from-bg via-bg to-transparent shrink-0 border-t border-white/5">
        <button
          onClick={handleSubmit}
          disabled={disabled || !isValid}
          className="px-12 py-6 bg-fg text-bg rounded-full font-bold text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-2xl"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
