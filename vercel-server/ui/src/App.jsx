import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import ContentCard from "./components/ContentCard.jsx";
import EventsLog from "./components/EventsLog.jsx";
import Footer from "./components/Footer.jsx";
import Header from "./components/Header.jsx";
import InteractionForm from "./components/InteractionForm.jsx";

export default function App() {
  const [history, setHistory] = useState([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [status, setStatus] = useState("connecting");
  const [workflowName, setWorkflowName] = useState("...");
  const [theme, setTheme] = useState("light");
  const [viewMode, setViewMode] = useState("present");
  const [pendingInteraction, setPendingInteraction] = useState(null);
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("rf_theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(savedTheme);
    const savedView = localStorage.getItem("rf_view") || "present";
    setViewMode(savedView);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("rf_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("rf_view", viewMode);
  }, [viewMode]);

  const token = window.SESSION_TOKEN === "{{" + "SESSION_TOKEN" + "}}" ? null : window.SESSION_TOKEN;
  const historyUrl = token ? `/api/history/${token}` : "/api/history";
  const eventsUrl = token ? `/api/events/${token}` : "/api/events";
  const submitUrl = token ? `/api/submit/${token}` : "/api/submit";

  const fetchData = async () => {
    try {
      const res = await fetch(historyUrl);
      const data = await res.json();
      if (data.entries) {
        const chronological = [...data.entries].reverse();
        setHistory((prev) => {
          if (prev.length === 0 && chronological.length > 0) {
            setPageIndex(chronological.length - 1);
          }
          return chronological;
        });
        const last = chronological[chronological.length - 1];
        if (last && (last.event === "INTERACTION_REQUESTED" || last.event === "PROMPT_REQUESTED")) {
          setPendingInteraction(last);
        } else {
          setPendingInteraction(null);
        }
      }
      if (data.workflowName) setWorkflowName(data.workflowName);
      setStatus("connected");
    } catch (error) {
      setStatus("disconnected");
    }
  };

  const prevLen = useRef(0);
  useEffect(() => {
    if (history.length > prevLen.current) {
      if (prevLen.current === 0 && history.length > 0) {
        setPageIndex(history.length - 1);
        setHasNew(false);
      } else if (pageIndex < history.length - 1) {
        setHasNew(true);
      }
    }
    prevLen.current = history.length;
  }, [history.length, pageIndex]);

  useEffect(() => {
    if (pageIndex === history.length - 1) {
      setHasNew(false);
    }
  }, [pageIndex, history.length]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    const es = new EventSource(eventsUrl);
    es.onmessage = (event) => {
      if (event.data === "update") fetchData();
    };
    return () => {
      clearInterval(interval);
      es.close();
    };
  }, []);

  const next = () => setPageIndex((prev) => Math.min(history.length - 1, prev + 1));
  const prev = () => setPageIndex((prev) => Math.max(0, prev - 1));

  useEffect(() => {
    const handler = (event) => {
      const isInput = event.target.tagName === "TEXTAREA" || (event.target.tagName === "INPUT" && event.target.type === "number");
      if (isInput && event.target.className !== "jumper-input") return;
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [history.length]);

  const currentItem = history[pageIndex];
  const isRequestEvent = currentItem && (currentItem.event === "INTERACTION_REQUESTED" || currentItem.event === "PROMPT_REQUESTED");
  const isRequest = pendingInteraction && isRequestEvent && currentItem.slug === pendingInteraction.slug;

  return (
    <div className="w-full h-[100dvh] flex flex-col relative overflow-hidden bg-bg">
      <Header
        workflowName={workflowName}
        status={status}
        theme={theme}
        toggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        viewMode={viewMode}
        setViewMode={setViewMode}
        history={history}
      />

      <main className="main-stage overflow-hidden">
        {viewMode === "log" ? (
          <EventsLog
            history={history}
            onJump={(idx) => {
              setPageIndex(idx);
              setViewMode("present");
            }}
          />
        ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={pageIndex}
            initial={{ opacity: 0, scale: 0.99, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 1.01, filter: "blur(4px)" }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full h-full"
          >
            {isRequest ? (
              <div className="content-width h-full">
                <InteractionForm
                  interaction={pendingInteraction}
                  onSubmit={async (slug, targetKey, response) => {
                    const responsePreview = typeof response === "string" ? response : JSON.stringify(response);
                    setHistory((prev) => [
                      ...prev,
                      {
                        timestamp: new Date().toISOString(),
                        event: "INTERACTION_SUBMITTED",
                        answer: responsePreview,
                        response
                      }
                    ]);
                    setPageIndex((prev) => prev + 1);
                    await fetch(submitUrl, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ slug, targetKey, response })
                    });
                    setTimeout(fetchData, 1000);
                  }}
                  disabled={status === "disconnected"}
                />
              </div>
            ) : (
              <ContentCard item={currentItem} />
            )}
          </motion.div>
        </AnimatePresence>
        )}
      </main>

      <Footer
        page={pageIndex}
        total={history.length}
        onNext={next}
        onPrev={prev}
        onJump={setPageIndex}
        hasNew={hasNew}
        onJumpToLatest={() => setPageIndex(history.length - 1)}
        className={viewMode === "log" ? "opacity-0 pointer-events-none" : "opacity-100"}
      />
    </div>
  );
}
