import { useDashboard } from "./lib/data";
import { usePath } from "./lib/router";
import { AgentProfile } from "./pages/AgentProfile";
import { Dashboard } from "./pages/Dashboard";
import { Docs } from "./pages/Docs";
import { Landing } from "./pages/Landing";

export default function App() {
  const path = usePath();

  if (path.startsWith("/docs")) {
    const slug = path.slice("/docs".length).replace(/^\//, "").replace(/\/$/, "");
    return <Docs key={`docs-${slug}`} slug={slug} />;
  }

  return <DataPages path={path} />;
}

/** Pages that need the live dashboard feed (docs doesn't). */
function DataPages({ path }: { path: string }) {
  const state = useDashboard();

  // key on path remounts the page container -> CSS page transition runs
  if (path.startsWith("/agent/")) {
    const id = decodeURIComponent(path.slice("/agent/".length));
    return <AgentProfile key={`agent-${id}`} state={state} id={id} />;
  }
  return path.startsWith("/dashboard") ? (
    <Dashboard key="dash" state={state} />
  ) : (
    <Landing key="landing" state={state} />
  );
}
