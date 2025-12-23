import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
