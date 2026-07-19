import { useEffect, useMemo, useRef, useState } from "react";
import { DOC_PAGES, docGroups, docHref, findDocPage, type DocPage } from "../docs/content";
import { navigate, onLinkClick } from "../lib/router";

/* ============================================================
   /docs — three-column docs layout: sidebar nav, article,
   "On this page" TOC. ⌘K search over titles + headings.
   ============================================================ */

function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    setActive(ids[0] ?? "");
    const headings = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActive(e.target.id);
            break;
          }
        }
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    headings.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [ids]);
  return active;
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOC_PAGES.map((page) => ({ page, section: undefined as string | undefined }));
    const out: { page: DocPage; section?: string; anchor?: string }[] = [];
    for (const page of DOC_PAGES) {
      if (page.title.toLowerCase().includes(q) || page.description.toLowerCase().includes(q)) {
        out.push({ page });
      }
      for (const s of page.sections) {
        if (s.title.toLowerCase().includes(q)) out.push({ page, section: s.title, anchor: s.id });
      }
    }
    return out;
  }, [query]);

  const go = (href: string) => {
    onClose();
    navigate(href);
  };

  return (
    <div
      className="doc-search-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && results.length > 0) {
          const r = results[0];
          go(docHref(r.page) + ("anchor" in r && r.anchor ? `#${r.anchor}` : ""));
        }
      }}
    >
      <div className="doc-search" role="dialog" aria-label="Search docs" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="doc-search-input"
          placeholder="Search docs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="doc-search-results">
          {results.length === 0 && <li className="doc-search-empty">No matches.</li>}
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => go(docHref(r.page) + ("anchor" in r && r.anchor ? `#${r.anchor}` : ""))}
              >
                <b>{r.page.title}</b>
                {r.section ? <span> › {r.section}</span> : <span className="muted"> — {r.page.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Docs({ slug }: { slug: string }) {
  const page = findDocPage(slug) ?? DOC_PAGES[0];
  const groups = docGroups();
  const flat = DOC_PAGES;
  const idx = flat.indexOf(page);
  const prev = idx > 0 ? flat[idx - 1] : undefined;
  const next = idx < flat.length - 1 ? flat[idx + 1] : undefined;

  const sectionIds = useMemo(() => page.sections.map((s) => s.id), [page]);
  const activeId = useScrollSpy(sectionIds);
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // ⌘K / Ctrl+K opens search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On page change: honor #hash, else scroll to top.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();
    else window.scrollTo(0, 0);
    setNavOpen(false);
  }, [page]);

  // Delegate clicks on in-article internal links to the SPA router.
  const onArticleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (a.target === "_blank" || !href.startsWith("/")) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <div className="page docs">
      <nav className="docs-topbar">
        <div className="docs-topbar-inner">
          <a href="/" onClick={onLinkClick} className="home-link">
            <span className="wordmark">
              PROVENN <small>docs</small>
            </span>
          </a>
          <button type="button" className="doc-search-btn" onClick={() => setSearchOpen(true)}>
            Search <kbd>⌘K</kbd>
          </button>
          <button
            type="button"
            className="doc-nav-toggle"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            Menu
          </button>
          <a href="/dashboard" onClick={onLinkClick} className="cta docs-launch">
            Launch app →
          </a>
        </div>
      </nav>

      <div className="docs-shell">
        <aside className={`docs-sidebar${navOpen ? " open" : ""}`}>
          {groups.map((g) => (
            <div key={g.label} className="docs-group">
              <div className="docs-group-label">{g.label}</div>
              {g.pages.map((p) => (
                <a
                  key={p.slug}
                  href={docHref(p)}
                  onClick={onLinkClick}
                  className={p === page ? "active" : ""}
                  aria-current={p === page ? "page" : undefined}
                >
                  {p.title}
                </a>
              ))}
            </div>
          ))}
        </aside>

        <article className="docs-article" onClick={onArticleClick}>
          <p className="docs-crumb">
            {page.group} <span>/</span> {page.title}
          </p>
          <h1>{page.title}</h1>
          <p className="docs-lede">{page.description}</p>

          {page.sections.map((s) => (
            <section key={s.id} className="docs-section">
              <h2 id={s.id}>
                <a href={`#${s.id}`} className="docs-anchor" aria-label={`Link to ${s.title}`}>
                  #
                </a>
                {s.title}
              </h2>
              {s.body}
            </section>
          ))}

          <footer className="docs-pager">
            {prev ? (
              <a href={docHref(prev)} onClick={onLinkClick} className="pager-link prev">
                <small>← Previous</small>
                <b>{prev.title}</b>
              </a>
            ) : (
              <span />
            )}
            {next ? (
              <a href={docHref(next)} onClick={onLinkClick} className="pager-link next">
                <small>Next →</small>
                <b>{next.title}</b>
              </a>
            ) : (
              <span />
            )}
          </footer>
        </article>

        <aside className="docs-toc">
          <div className="docs-group-label">On this page</div>
          {page.sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={s.id === activeId ? "active" : ""}>
              {s.title}
            </a>
          ))}
        </aside>
      </div>

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
