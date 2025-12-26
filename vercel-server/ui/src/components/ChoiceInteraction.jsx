import { useEffect, useMemo, useState } from "react";
import { Bot, Check } from "lucide-react";

export default function ChoiceInteraction({ interaction, onSubmit, disabled }) {
  const { prompt, question, options = [], multiSelect, allowCustom, fullAuto, autoSelectDelay = 20, timestamp } = interaction;
  const [selected, setSelected] = useState(multiSelect ? [] : null);
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [tick, setTick] = useState(0);

  const list = useMemo(() => options || [], [options]);
  const title = prompt || question || "Choose an option.";

  // Calculate countdown based on event timestamp
  const countdown = useMemo(() => {
    if (!fullAuto || !timestamp) return null;
    const eventTime = new Date(timestamp).getTime();
    const elapsed = Math.floor((Date.now() - eventTime) / 1000);
    return autoSelectDelay - elapsed;
  }, [fullAuto, timestamp, autoSelectDelay, tick]);

  // Tick every second to update countdown
  useEffect(() => {
    if (!fullAuto) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [fullAuto]);

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
          <div className="w-16 h-16 rounded-3xl bg-black text-white dark:bg-white dark:text-black flex items-center justify-center mx-auto shadow-2xl shadow-black/20 dark:shadow-white/10">
            <Bot className="w-8 h-8" />
          </div>
          <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-fg pt-4 text-center">Choose an option.</h3>
        </div>

        <div className="text-lg sm:text-xl font-medium text-fg/70 text-center max-w-2xl whitespace-pre-wrap break-words">
          {title}
        </div>

        {fullAuto && countdown !== null && (
          <div className="text-center">
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
              countdown > 0
                ? "bg-yellow-500 text-black animate-pulse"
                : "bg-black text-white dark:bg-white dark:text-black"
            }`}>
              <span className="text-xl">⚡</span>
              <span className="text-sm font-bold">
                {countdown > 0
                  ? `Agent deciding in ${countdown}s...`
                  : "Auto-selecting recommended option..."}
              </span>
            </div>
          </div>
        )}

        <div className="w-full max-w-2xl space-y-3">
          {list.map((opt, index) => {
            const isSelected = multiSelect ? selected.includes(opt.key) : selected === opt.key;
            const labelClass = isSelected
              ? "text-white dark:text-black"
              : "text-black dark:text-white";
            const descriptionClass = isSelected
              ? "text-white/70 dark:text-black/70"
              : "text-black/50 dark:text-white/50";

            return (
              <button
                key={opt.key}
                onClick={() => handleSelect(opt.key)}
                disabled={disabled}
                type="button"
                className={`w-full p-6 rounded-2xl border-2 transition-all text-left ${
                  isSelected
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 bg-black/[0.02] dark:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                    isSelected
                      ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-black/30 dark:border-white/30"
                  }`}>
                    {isSelected && <Check className="w-4 h-4" />}
                  </div>
                  <div className="flex-1">
                    <div className={`font-bold text-lg break-words flex flex-wrap items-center gap-2 ${labelClass}`}>
                      <span className="break-words">{opt.label || opt.key}</span>
                      {index === 0 && (
                        <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${
                          isSelected
                            ? 'bg-white/20 dark:bg-black/20'
                            : 'bg-black/10 dark:bg-white/10'
                        }`}>
                          Recommended
                        </span>
                      )}
                    </div>
                    {opt.description && <div className={`text-sm mt-1 break-words ${descriptionClass}`}>{opt.description}</div>}
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
                  ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                  : "border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 bg-black/[0.02] dark:bg-white/[0.03]"
              }`}
            >
              <div className={`font-bold text-lg break-words ${showCustom ? "text-white dark:text-black" : "text-black dark:text-white"}`}>Other</div>
              <div className={`text-sm mt-1 break-words ${showCustom ? "text-white/70 dark:text-black/70" : "text-black/50 dark:text-white/50"}`}>Provide a custom response</div>
            </button>
          )}

          {showCustom && (
            <textarea
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              placeholder="Type your response..."
              className="w-full h-32 p-6 rounded-2xl bg-black/[0.02] dark:bg-white/[0.03] border-2 border-black/20 dark:border-white/20 focus:border-black dark:focus:border-white focus:outline-none text-lg"
            />
          )}
        </div>
      </div>

      <div className="p-4 flex justify-center bg-gradient-to-t from-bg via-bg to-transparent shrink-0 border-t border-black/10 dark:border-white/10">
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
