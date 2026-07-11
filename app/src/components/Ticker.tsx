import type { WatchCard } from "../lib/types";

/** Scrolling odds strip — decoration that happens to be true. */
export function Ticker({ watch }: { watch: WatchCard[] }) {
  const items = watch.filter((w) => w.probs?.length === 3);
  if (items.length === 0) return null;

  const strip = items.map((w) => (
    <span className="tick" key={w.matchId}>
      <b>{w.fixture}</b>
      {w.probs!.map((p, i) => (
        <span key={i} className="mono tick-num">
          {(p * 100).toFixed(1)}
        </span>
      ))}
    </span>
  ));

  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {strip}
        {strip.map((el, i) => (
          <span key={`dup-${i}`}>{el}</span>
        ))}
      </div>
    </div>
  );
}
