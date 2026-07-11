import { useDashboard } from "./lib/data";
import { usePath } from "./lib/router";
import { Dashboard } from "./pages/Dashboard";
import { Landing } from "./pages/Landing";

export default function App() {
  const path = usePath();
  const state = useDashboard();

  // key on path remounts the page container -> CSS page transition runs
  return path.startsWith("/dashboard") ? (
    <Dashboard key="dash" state={state} />
  ) : (
    <Landing key="landing" state={state} />
  );
}
