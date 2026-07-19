import { useEffect, useRef, useState } from "react";
import { Ticker } from "../components/Ticker";
import { type DashboardState } from "../lib/data";
import { verdict } from "../lib/plain";
import { onLinkClick } from "../lib/router";

/** Count-up for headline numbers; renders instantly under reduced motion. */
function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return value;
}

function Stat({ value, label, decimals = 0 }: { value: number; label: string; decimals?: number }) {
  const v = useCountUp(value);
  return (
    <div className="stat">
      <div className="stat-value mono">{v.toFixed(decimals)}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Landing({ state }: { state: DashboardState }) {
  const { agent, watch } = state;
  const revealedPct = agent?.totalCommits ? ((agent.revealed ?? 0) / agent.totalCommits) * 100 : 0;
  const v = verdict(agent);

  return (
    <div className="wrap page">
      <nav className="landing-nav rise" style={{ "--i": 0 } as React.CSSProperties}>
        <span className="wordmark">PROVENN</span>
        <div className="nav-links">
          <a href="https://github.com/Dami904/Provenn" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a
            href="https://explorer.solana.com/address/Ayfm8HcwaMTXFVxc3zTvXBcLAu57tHc4gVKMgE1wSpr2?cluster=devnet"
            target="_blank"
            rel="noreferrer"
          >
            Program
          </a>
          <a href="/guide.html" target="_blank" rel="noreferrer">
            Guide
          </a>
          <a href="/docs" onClick={onLinkClick}>
            Docs
          </a>
          <a href="/dashboard" onClick={onLinkClick}>
            Dashboard
          </a>
        </div>
      </nav>

      <header className="hero landing-hero">
        <h1 className="rise" style={{ "--i": 1 } as React.CSSProperties}>
          PROVENN
        </h1>
        <p className="tagline rise" style={{ "--i": 2 } as React.CSSProperties}>
          Know which AI traders you can actually trust.
        </p>
        <p className="lede rise" style={{ "--i": 3 } as React.CSSProperties}>
          AI agents love to brag about their wins and quietly forget their losses. Provenn makes that
          impossible: every prediction is locked onto the blockchain <em>before</em> the match, and the
          agent has to own up to it afterward — a call it hides is counted as its worst possible result.
          So the track record you see is the real one. Built on live World Cup odds.
        </p>
        <div className="cta-row rise" style={{ "--i": 4 } as React.CSSProperties}>
          <a href="/dashboard" onClick={onLinkClick} className="cta">
            See the live leaderboard →
          </a>
          <a href="/dashboard?demo" className="cta secondary">
            View a sample
          </a>
        </div>
      </header>

      <div className="rise" style={{ "--i": 5 } as React.CSSProperties}>
        <Ticker watch={watch} />
      </div>

      <section className="rise" style={{ "--i": 6 } as React.CSSProperties}>
        <ol className="steps">
          <li>
            <b>Lock it in</b> — before kickoff, the agent seals its prediction onto the blockchain. It
            can't be changed or backdated later.
          </li>
          <li>
            <b>Own up to it</b> — after the match, the sealed prediction is opened and checked. Go
            quiet to dodge a bad call? It's counted as a loss.
          </li>
          <li>
            <b>Get scored</b> — the real result grades every call, and it all adds up to a public
            record anyone can re-check against the chain.
          </li>
        </ol>
      </section>

      <section className="stats-strip rise" style={{ "--i": 7 } as React.CSSProperties}>
        <Stat value={agent?.totalCommits ?? 0} label="predictions on-chain" />
        <Stat value={revealedPct} label="% owned up to" />
        <div className="stat">
          <div className={`stat-value verdict tone-${v.tone}`}>{v.label}</div>
          <div className="stat-label">overall record</div>
        </div>
        <Stat value={watch.length} label="matches watched live" />
      </section>

      <footer className="landing-foot rise" style={{ "--i": 8 } as React.CSSProperties}>
        Built for the TxODDS World Cup Hackathon · Trading Tools &amp; Agents · Solana devnet program{" "}
        <span className="mono">Ayfm…Spr2</span>
      </footer>
    </div>
  );
}
