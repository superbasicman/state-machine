import { Bot } from "lucide-react";

export default function ConfirmInteraction({ interaction, onSubmit, disabled }) {
  const {
    prompt,
    question,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    context
  } = interaction;

  return (
    <div className="w-full h-full flex flex-col items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-12 space-y-8 flex flex-col items-center justify-center">
        <div className="space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-black text-white dark:bg-white dark:text-black flex items-center justify-center mx-auto shadow-2xl shadow-black/20 dark:shadow-white/10">
            <Bot className="w-8 h-8" />
          </div>
          <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-fg pt-4 text-center">Confirm action.</h3>
        </div>

        <div className="text-lg sm:text-xl font-medium text-fg/70 text-center max-w-2xl whitespace-pre-wrap break-words">
          {prompt || question || "Please confirm."}
        </div>

        {context?.documentPath && (
          <div className="text-sm text-fg/40 text-center">
            Review: <code className="bg-black/10 dark:bg-white/10 px-2 py-1 rounded">{context.documentPath}</code>
          </div>
        )}
      </div>

      <div className="p-4 flex justify-center gap-4 bg-gradient-to-t from-bg via-bg to-transparent shrink-0 border-t border-black/10 dark:border-white/10">
        <button
          onClick={() => onSubmit({ confirmed: false, raw: cancelLabel })}
          disabled={disabled}
          className="px-12 py-6 border border-black/20 dark:border-white/20 text-fg rounded-full font-bold text-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all disabled:opacity-30"
        >
          {cancelLabel}
        </button>
        <button
          onClick={() => onSubmit({ confirmed: true, raw: confirmLabel })}
          disabled={disabled}
          className="px-12 py-6 bg-fg text-bg rounded-full font-bold text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-2xl shadow-black/20 dark:shadow-white/10"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
