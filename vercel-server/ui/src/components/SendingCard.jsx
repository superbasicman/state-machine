import { Loader2 } from "lucide-react";

export default function SendingCard({ submission }) {
  const subtitle = submission?.slug
    ? `Waiting for the CLI to receive ${submission.slug} and log the next event.`
    : "Waiting for the CLI to receive the response and log the next event.";

  return (
    <div className="w-full h-full flex items-center justify-center px-6 py-12 bg-white text-black dark:bg-black dark:text-white">
      <div className="content-width w-full flex flex-col items-center text-center gap-6">
        <div className="relative">
          <div
            className="absolute -inset-4 rounded-[36px] bg-black/10 dark:bg-white/10 blur-2xl opacity-60"
            aria-hidden="true"
          />
          <div className="relative w-20 h-20 rounded-[28px] border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] flex items-center justify-center shadow-2xl shadow-black/20 dark:shadow-white/10">
            <Loader2 className="w-9 h-9 text-black dark:text-white animate-spin" />
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-4xl font-black tracking-tight">Sending response</div>
          <div className="text-lg font-medium text-black/60 dark:text-white/60 max-w-xl break-words">
            {subtitle}
          </div>
          <div className="text-[10px] font-bold tracking-[0.35em] uppercase opacity-30">
            Keep this tab open
          </div>
        </div>
      </div>
    </div>
  );
}
