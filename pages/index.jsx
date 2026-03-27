import { useState, useCallback, useRef } from "react";
import Head from "next/head";

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIONS = [
  "Berlin","Hamburg","München","Köln","Frankfurt am Main",
  "Stuttgart","Düsseldorf","Dortmund","Essen","Leipzig",
  "Bremen","Dresden","Hannover","Nürnberg","Duisburg",
  "Bochum","Wuppertal","Bielefeld","Bonn","Münster",
  "Karlsruhe","Mannheim","Augsburg","Wiesbaden","Gelsenkirchen",
  "Mönchengladbach","Braunschweig","Kiel","Chemnitz","Aachen",
  "Halle (Saale)","Magdeburg","Freiburg im Breisgau","Krefeld",
  "Lübeck","Oberhausen","Erfurt","Mainz","Rostock","Kassel",
];

const QUAL_KEYWORDS = [
  "kein rückruf","nicht erreichbar","telefon besetzt","niemand abgehoben",
  "keiner meldet sich","keine antwort","schlechte erreichbarkeit",
  "anrufbeantworter","nicht zurückgerufen","niemand geht ran",
  "nicht ans telefon","warteschleife","kein ansprechpartner",
  "meldet sich nicht","geht nicht ran","mehrmals angerufen",
  "nochmal angerufen","kommt nie","nicht gemeldet",
];

const STAR_COLORS = { 1:"#ef4444", 2:"#f97316", 3:"#eab308", 4:"#84cc16", 5:"#22c55e" };

// ─── Utils ────────────────────────────────────────────────────────────────────

function extractDomain(url = "") {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "");
  } catch { return null; }
}

function apolloOrgUrl(name, domain) {
  if (domain) return `https://app.apollo.io/#/organizations?q_organization_domains[]=${encodeURIComponent(domain)}`;
  return `https://app.apollo.io/#/organizations?q_organization_names[]=${encodeURIComponent(name)}`;
}

function apolloPeopleUrl(name, domain) {
  const params = new URLSearchParams();
  if (domain) params.set("q_organization_domains[]", domain);
  else params.set("q_organization_names[]", name);
  params.set("q_person_titles[]", "Geschäftsführer");
  return `https://app.apollo.io/#/people?${params.toString()}`;
}

function detectQualSignals(reviews = []) {
  const signals = new Set();
  const examples = [];
  for (const rev of reviews) {
    const text = (rev?.text?.text || rev?.originalText?.text || "").toLowerCase();
    if (!text) continue;
    for (const kw of QUAL_KEYWORDS) {
      if (text.includes(kw)) {
        signals.add(kw.charAt(0).toUpperCase() + kw.slice(1));
        const full = rev?.text?.text || rev?.originalText?.text || "";
        if (examples.length < 3 && !examples.includes(full))
          examples.push(full.length > 180 ? full.slice(0, 180) + "…" : full);
      }
    }
  }
  return { signals: [...signals], examples };
}

// ─── API calls (now hitting OUR server routes) ────────────────────────────────

async function apiSearchPlaces(query) {
  const res = await fetch("/api/places-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Fehler ${res.status}`);
  }
  return (await res.json()).places || [];
}

async function apiFetchReviews(placeId) {
  const res = await fetch(`/api/places-detail?placeId=${encodeURIComponent(placeId)}`);
  if (!res.ok) return { reviews: [] };
  return res.json();
}

async function apiHunter(domain) {
  const res = await fetch(`/api/hunter?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Hunter Fehler ${res.status}`);
  }
  return res.json();
}

// ─── UI Components ────────────────────────────────────────────────────────────

function StarRating({ rating }) {
  const c = STAR_COLORS[Math.round(rating)] || "#6b7280";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      {[1,2,3,4,5].map(s => (
        <svg key={s} width="13" height="13" viewBox="0 0 24 24" fill={s <= Math.round(rating) ? c : "#1f2937"}>
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
        </svg>
      ))}
      <span style={{ color:c, fontSize:13, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>
        {rating?.toFixed(1) ?? "–"}
      </span>
    </div>
  );
}

function ConfidenceDot({ score }) {
  const c = score >= 80 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444";
  const label = score >= 80 ? "hoch" : score >= 50 ? "mittel" : "niedrig";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:c, display:"inline-block" }}/>
      <span style={{ fontSize:10, color:c, fontFamily:"'IBM Plex Mono',monospace" }}>{score}% {label}</span>
    </span>
  );
}

function HunterPanel({ result, loading, error, domain }) {
  if (loading) return (
    <div style={{ padding:"10px 0", fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", animation:"pulse 1s infinite" }}>
      ↻ Hunter.io durchsucht {domain}…
    </div>
  );
  if (error) return (
    <div style={{ padding:"8px 10px", background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:5, fontSize:11, color:"#fca5a5", fontFamily:"'IBM Plex Mono',monospace" }}>
      ✗ {error}
    </div>
  );
  if (!result) return null;
  const { organization, emails = [], pattern } = result;
  return (
    <div style={{ marginTop:4 }}>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8, alignItems:"center" }}>
        {pattern && (
          <span style={{ background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.25)", color:"#93c5fd", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 8px", borderRadius:3 }}>
            📧 Muster: {pattern}@{domain}
          </span>
        )}
        {organization && <span style={{ fontSize:11, color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace" }}>{organization}</span>}
      </div>
      {emails.length > 0 ? (
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          {emails.map((e, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:5, padding:"7px 10px" }}>
              <div style={{ flex:1 }}>
                {e.first_name && (
                  <div style={{ fontSize:11, color:"#9ca3af", fontFamily:"'DM Sans',sans-serif", marginBottom:2 }}>
                    {e.first_name} {e.last_name}
                    {e.position && <span style={{ color:"#4b5563" }}> · {e.position}</span>}
                  </div>
                )}
                <a href={`mailto:${e.value}`} style={{ fontSize:12, color:"#60a5fa", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>
                  {e.value}
                </a>
              </div>
              <ConfidenceDot score={e.confidence || 0} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace" }}>
          Keine E-Mail-Adressen für diese Domain gefunden
        </div>
      )}
    </div>
  );
}

function LeadCard({ lead, rank, reviewing }) {
  const [open, setOpen]               = useState(false);
  const [tab, setTab]                 = useState("reviews");
  const [hunterData, setHunterData]   = useState(null);
  const [hunterLoading, setHunterLoading] = useState(false);
  const [hunterError, setHunterError] = useState("");

  const isHot  = lead.signals?.length > 0;
  const domain = extractDomain(lead.website || "");

  const runHunter = async (e) => {
    e.stopPropagation();
    if (!domain) { setHunterError("Keine Website für diese Firma bekannt."); setTab("hunter"); setOpen(true); return; }
    setTab("hunter"); setOpen(true);
    if (hunterData) return;
    setHunterLoading(true); setHunterError("");
    try {
      const data = await apiHunter(domain);
      setHunterData(data);
    } catch (err) {
      setHunterError(err.message || "Hunter Fehler");
    } finally {
      setHunterLoading(false);
    }
  };

  const openApollo = (e) => {
    e.stopPropagation();
    window.open(apolloPeopleUrl(lead.name, domain), "_blank", "noopener");
  };

  return (
    <div
      onClick={() => setOpen(!open)}
      style={{ background: isHot ? "rgba(239,68,68,0.04)" : "rgba(255,255,255,0.02)", border:`1px solid ${isHot ? "rgba(239,68,68,0.22)" : "rgba(255,255,255,0.07)"}`, borderRadius:8, padding:"14px 18px", cursor:"pointer", transition:"border-color .15s" }}
    >
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", minWidth:22 }}>#{rank}</span>
            <span style={{ fontSize:15, fontWeight:700, color:"#f9fafb", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:260 }}>
              {lead.name}
            </span>
            {isHot && <span style={{ background:"rgba(239,68,68,0.18)", color:"#ef4444", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 6px", borderRadius:2, letterSpacing:"0.06em", flexShrink:0 }}>🔥 HOT LEAD</span>}
            {reviewing && <span style={{ fontSize:10, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", animation:"pulse 1s infinite" }}>↻ analysiere…</span>}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7, alignItems:"center", marginBottom:6 }}>
            {lead.address && <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>📍 {lead.address}</span>}
            {lead.website && (
              <a href={lead.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                style={{ fontSize:11, color:"#3b82f6", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>
                🔗 {domain}
              </a>
            )}
            {lead.phone && (
              <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>
                📞 {lead.phone}
              </a>
            )}
          </div>
          {isHot && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
              {lead.signals.slice(0, 4).map((s, i) => (
                <span key={i} style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.35)", color:"#fca5a5", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 7px", borderRadius:3, whiteSpace:"nowrap" }}>⚠ {s}</span>
              ))}
              {lead.signals.length > 4 && <span style={{ background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.25)", color:"#93c5fd", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 7px", borderRadius:3 }}>+{lead.signals.length - 4} weitere</span>}
            </div>
          )}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }} onClick={e => e.stopPropagation()}>
            <button onClick={runHunter}
              style={{ display:"flex", alignItems:"center", gap:5, background: tab === "hunter" && open ? "rgba(251,146,60,0.18)" : "rgba(255,255,255,0.04)", border:`1px solid ${tab === "hunter" && open ? "rgba(251,146,60,0.45)" : "rgba(255,255,255,0.1)"}`, color: tab === "hunter" && open ? "#fb923c" : "#6b7280", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"4px 10px", borderRadius:5 }}>
              📧 Hunter.io
              {hunterData?.emails?.length > 0 && <span style={{ background:"#fb923c", color:"#000", borderRadius:3, fontSize:9, padding:"1px 5px", fontWeight:700 }}>{hunterData.emails.length}</span>}
            </button>
            <button onClick={openApollo}
              style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(139,92,246,0.08)", border:"1px solid rgba(139,92,246,0.25)", color:"#a78bfa", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"4px 10px", borderRadius:5 }}>
              🔍 Apollo.io →
            </button>
            <a href={`https://www.google.com/maps/place/?q=place_id:${lead.placeId}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(34,197,94,0.07)", border:"1px solid rgba(34,197,94,0.2)", color:"#86efac", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"4px 10px", borderRadius:5, textDecoration:"none" }}>
              🗺 Maps
            </a>
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3, flexShrink:0 }}>
          {lead.rating ? <StarRating rating={lead.rating} /> : <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>– / 5</span>}
          <span style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace" }}>{lead.reviewCount ?? 0} Bew.</span>
          {lead.phone && <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>📞 {lead.phone}</a>}
          <span style={{ fontSize:10, color:"#1f2937", marginTop:6 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ marginTop:14, paddingTop:14, borderTop:"1px solid rgba(255,255,255,0.05)" }} onClick={e => e.stopPropagation()}>
          <div style={{ display:"flex", gap:6, marginBottom:14 }}>
            {[{ id:"reviews", label:"📋 Reviews" }, { id:"hunter", label:"📧 Hunter.io" }, { id:"apollo", label:"🔍 Apollo" }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", background: tab === t.id ? "rgba(255,255,255,0.07)" : "transparent", border:`1px solid ${tab === t.id ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)"}`, color: tab === t.id ? "#f9fafb" : "#4b5563", padding:"5px 12px", borderRadius:5 }}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "reviews" && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.25)", color:"#86efac", padding:"2px 8px", borderRadius:3 }}>✓ ECHTZEIT · GOOGLE PLACES API</span>
              </div>
              {lead.reviewExamples?.length > 0 && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", marginBottom:6 }}>ERREICHBARKEITS-SIGNALE</div>
                  {lead.reviewExamples.map((r, i) => (
                    <div key={i} style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.14)", borderRadius:5, padding:"9px 12px", marginBottom:5, fontSize:12, color:"#fca5a5", lineHeight:1.55 }}>„{r}"</div>
                  ))}
                </div>
              )}
              {lead.allReviews?.length > 0 && (
                <div>
                  <div style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", marginBottom:6 }}>LETZTE {lead.allReviews.length} GOOGLE REVIEWS</div>
                  {lead.allReviews.map((r, i) => {
                    const txt = r?.text?.text || r?.originalText?.text || "";
                    const rc  = STAR_COLORS[r.rating] || "#6b7280";
                    return (
                      <div key={i} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:5, padding:"9px 12px", marginBottom:5 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, gap:8 }}>
                          <span style={{ fontSize:11, color:"#9ca3af" }}>{r.authorAttribution?.displayName || "Anonym"}</span>
                          <div style={{ display:"flex", gap:2 }}>{[1,2,3,4,5].map(s => <svg key={s} width="10" height="10" viewBox="0 0 24 24" fill={s <= (r.rating || 0) ? rc : "#1f2937"}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>)}</div>
                        </div>
                        <div style={{ fontSize:12, color:"#6b7280", lineHeight:1.5 }}>{txt.slice(0, 220)}{txt.length > 220 ? "…" : ""}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {lead.reviewsLoaded && !lead.allReviews?.length && <div style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace" }}>Keine öffentlichen Reviews verfügbar.</div>}
            </div>
          )}

          {tab === "hunter" && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(251,146,60,0.1)", border:"1px solid rgba(251,146,60,0.25)", color:"#fb923c", padding:"2px 8px", borderRadius:3 }}>📧 HUNTER.IO · E-MAIL FINDER</span>
                {domain && <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>{domain}</span>}
                {!hunterData && !hunterLoading && !hunterError && (
                  <button onClick={runHunter} style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(251,146,60,0.15)", border:"1px solid rgba(251,146,60,0.35)", color:"#fb923c", padding:"4px 12px", borderRadius:5 }}>Jetzt suchen →</button>
                )}
              </div>
              <HunterPanel result={hunterData} loading={hunterLoading} error={hunterError} domain={domain} />
              {!domain && !hunterError && <div style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>⚠ Keine Website bekannt – Hunter.io benötigt eine Domain.</div>}
            </div>
          )}

          {tab === "apollo" && (
            <div>
              <div style={{ marginBottom:10 }}>
                <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.25)", color:"#a78bfa", padding:"2px 8px", borderRadius:3 }}>🔍 APOLLO.IO DEEP-LINKS</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[
                  { href: apolloOrgUrl(lead.name, domain), icon:"🏢", label:"Firma in Apollo suchen", sub: domain ? `domain:${domain}` : lead.name, c:"#c4b5fd", bg:"rgba(139,92,246,0.07)", border:"rgba(139,92,246,0.2)" },
                  { href: apolloPeopleUrl(lead.name, domain), icon:"👤", label:"Geschäftsführer finden", sub:`Titel: Geschäftsführer · ${domain || lead.name}`, c:"#c4b5fd", bg:"rgba(139,92,246,0.07)", border:"rgba(139,92,246,0.2)" },
                  { href:`https://app.apollo.io/#/people?q_organization_names[]=${encodeURIComponent(lead.name)}&q_person_linkedin_url=true`, icon:"in", label:"LinkedIn-Profile via Apollo", sub:`Personen mit LinkedIn · ${lead.name}`, c:"#7dd3fc", bg:"rgba(14,118,168,0.07)", border:"rgba(14,118,168,0.2)" },
                ].map((l, i) => (
                  <a key={i} href={l.href} target="_blank" rel="noopener noreferrer"
                    style={{ display:"flex", alignItems:"center", gap:10, background:l.bg, border:`1px solid ${l.border}`, borderRadius:7, padding:"11px 14px", textDecoration:"none" }}>
                    <div style={{ width:32, height:32, background:`${l.bg}`, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{l.icon}</div>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600, color:l.c, marginBottom:2 }}>{l.label}</div>
                      <div style={{ fontSize:10, color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace" }}>{l.sub}</div>
                    </div>
                    <span style={{ marginLeft:"auto", fontSize:14, color:l.c }}>→</span>
                  </a>
                ))}
              </div>
              <div style={{ marginTop:12, fontSize:10, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", lineHeight:1.6 }}>
                ⓘ Öffnet Apollo mit vorausgefüllten Filtern. Kostenloser Apollo-Account ausreichend.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [region,    setRegion]    = useState("");
  const [custom,    setCustom]    = useState("");
  const [leads,     setLeads]     = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [reviewing, setReviewing] = useState(new Set());
  const [progress,  setProgress]  = useState({ done:0, total:0, phase:"" });
  const [error,     setError]     = useState("");
  const [sortBy,    setSortBy]    = useState("hot_first");
  const [filterHot, setFilterHot] = useState(false);
  const [done,      setDone]      = useState(false);
  const abortRef = useRef(false);
  const effectiveRegion = custom || region;

  const runSearch = useCallback(async () => {
    if (!effectiveRegion) return;
    abortRef.current = false;
    setLoading(true); setLeads([]); setDone(false); setError("");
    setProgress({ done:0, total:0, phase:"Suche Containerdienste in Google Maps…" });
    try {
      const places = await apiSearchPlaces(`Containerdienst Entsorgung ${effectiveRegion}`);
      if (!places.length) { setError("Keine Ergebnisse für diese Region."); setLoading(false); return; }

      const initial = places.map(p => ({
        placeId: p.id,
        name: p.displayName?.text || "Unbekannt",
        address: p.formattedAddress || "",
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? 0,
        website: p.websiteUri || null,
        phone: p.nationalPhoneNumber || null,
        signals:[], reviewExamples:[], allReviews:[], reviewsLoaded:false,
      }));
      setLeads(initial);
      setProgress({ done:0, total:initial.length, phase:"Analysiere Reviews…" });

      for (let i = 0; i < initial.length; i++) {
        if (abortRef.current) break;
        const lead = initial[i];
        setReviewing(prev => new Set([...prev, lead.placeId]));
        try {
          const { reviews, rating, reviewCount } = await apiFetchReviews(lead.placeId);
          const { signals, examples } = detectQualSignals(reviews);
          initial[i] = { ...lead, rating: rating ?? lead.rating, reviewCount: reviewCount ?? lead.reviewCount, signals, reviewExamples: examples, allReviews: reviews, reviewsLoaded: true };
          setLeads([...initial]);
        } catch { initial[i] = { ...lead, reviewsLoaded:true }; setLeads([...initial]); }
        setReviewing(prev => { const n = new Set(prev); n.delete(lead.placeId); return n; });
        setProgress({ done:i+1, total:initial.length, phase:"Analysiere Reviews…" });
        if (i < initial.length - 1) await new Promise(r => setTimeout(r, 160));
      }
      setDone(true);
    } catch (e) { setError(e.message || "Fehler – bitte Administrator kontaktieren."); }
    finally { setLoading(false); setProgress({ done:0, total:0, phase:"" }); }
  }, [effectiveRegion]);

  const sorted = [...leads]
    .filter(l => !filterHot || l.signals?.length > 0)
    .sort((a, b) => {
      if (sortBy === "hot_first")    { const d = (b.signals?.length||0)-(a.signals?.length||0); return d || ((a.rating??5)-(b.rating??5)); }
      if (sortBy === "rating_asc")   return (a.rating??5)-(b.rating??5);
      if (sortBy === "rating_desc")  return (b.rating??0)-(a.rating??0);
      if (sortBy === "reviews_desc") return (b.reviewCount||0)-(a.reviewCount||0);
      return 0;
    });

  const hotCount  = leads.filter(l => l.signals?.length > 0).length;
  const rated     = leads.filter(l => l.rating);
  const avgRating = rated.length ? (rated.reduce((s,l) => s+l.rating, 0) / rated.length).toFixed(1) : null;

  const exportCSV = () => {
    const h = ["#","Firma","Adresse","Bewertung","Reviews","Website","Telefon","Hot Lead","Signale","Review-Zitat","Place ID"];
    const rows = sorted.map((l,i) => [i+1,`"${l.name}"`,`"${l.address}"`,l.rating??"",l.reviewCount??0,`"${l.website||""}"`,`"${l.phone||""}"`,l.signals?.length>0?"JA":"NEIN",`"${(l.signals||[]).join("; ")}"`,`"${(l.reviewExamples?.[0]||"").replace(/"/g,"'")}"`,`"${l.placeId}"`]);
    const csv = [h, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8;" }));
    a.download = `waiste-leads-${effectiveRegion}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <>
      <Head>
        <title>wAIste Lead Finder</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>♻</text></svg>" />
      </Head>

      {/* Header */}
      <div style={{ background:"linear-gradient(180deg,#0d1117 0%,#07090f 100%)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"20px 28px 18px", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ maxWidth:940, margin:"0 auto", display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:38, height:38, borderRadius:9, background:"linear-gradient(135deg,#16a34a,#0f6b2e)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>♻</div>
          <div>
            <div style={{ fontSize:19, fontWeight:700, color:"#f9fafb", letterSpacing:"-0.02em" }}>
              wAIste <span style={{ color:"#16a34a" }}>Lead Finder</span>
              <span style={{ marginLeft:10, fontSize:9, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(34,197,94,0.15)", border:"1px solid rgba(34,197,94,0.3)", color:"#86efac", padding:"2px 7px", borderRadius:3, verticalAlign:"middle" }}>LIVE</span>
            </div>
            <div style={{ fontSize:10, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.06em", marginTop:2 }}>
              GOOGLE PLACES · HUNTER.IO · APOLLO.IO · KMU CONTAINERDIENSTE DEUTSCHLAND
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:940, margin:"0 auto", padding:"22px 28px 48px" }}>

        {/* Search */}
        <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"18px 20px", marginBottom:20 }}>
          <div style={{ fontSize:10, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", marginBottom:12, letterSpacing:"0.08em" }}>REGION AUSWÄHLEN</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <select value={region} onChange={e => { setRegion(e.target.value); setCustom(""); }}
              style={{ flex:1, minWidth:160, background:"#0a0f17", border:"1px solid rgba(255,255,255,0.09)", color:region?"#f9fafb":"#374151", borderRadius:6, padding:"9px 12px", fontSize:13 }}>
              <option value="">Stadt wählen…</option>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <input type="text" placeholder="oder eigene Eingabe (Landkreis Emsland, Rhein-Main…)"
              value={custom} onChange={e => { setCustom(e.target.value); setRegion(""); }}
              style={{ flex:2, minWidth:210, background:"#0a0f17", border:"1px solid rgba(255,255,255,0.09)", color:"#f9fafb", borderRadius:6, padding:"9px 12px", fontSize:13 }}/>
            <button onClick={runSearch} disabled={loading || !effectiveRegion}
              style={{ background: loading ? "#14532d" : !effectiveRegion ? "#141a12" : "#15803d", color:"#fff", border:"none", borderRadius:6, padding:"9px 20px", fontSize:13, fontWeight:600, whiteSpace:"nowrap", opacity:!effectiveRegion?0.4:1 }}>
              {loading ? <span style={{ animation:"pulse 1s infinite" }}>⟳ Suche…</span> : "🔍 Leads suchen"}
            </button>
            {loading && <button onClick={() => { abortRef.current = true; }} style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)", color:"#fca5a5", borderRadius:6, padding:"9px 14px", fontSize:12, fontFamily:"'IBM Plex Mono',monospace" }}>✕</button>}
          </div>
          {loading && progress.total > 0 && (
            <div style={{ marginTop:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>{progress.phase}</span>
                <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>{progress.done}/{progress.total}</span>
              </div>
              <div style={{ height:3, background:"#111827", borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:2, background:"linear-gradient(90deg,#15803d,#22c55e)", width:`${(progress.done/progress.total)*100}%`, transition:"width .3s ease" }}/>
              </div>
            </div>
          )}
        </div>

        {error && <div style={{ background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"12px 16px", color:"#fca5a5", fontFamily:"'IBM Plex Mono',monospace", fontSize:12, marginBottom:18 }}>✗ {error}</div>}

        {loading && leads.length === 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[...Array(8)].map((_,i) => <div key={i} style={{ height:88, borderRadius:8, background:"linear-gradient(90deg,rgba(255,255,255,0.02) 25%,rgba(255,255,255,0.05) 50%,rgba(255,255,255,0.02) 75%)", backgroundSize:"600px 100%", animation:`shimmer 1.4s ${i*0.07}s infinite linear` }}/>)}
          </div>
        )}

        {leads.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:14 }}>
              {[
                { label:"Gefunden",            val:leads.length,  col:"#f9fafb" },
                { label:"Hot Leads 🔥",        val:hotCount,      col:"#ef4444" },
                { label:"Ø Bewertung",         val:avgRating?`${avgRating} ★`:"–", col:avgRating?STAR_COLORS[Math.round(parseFloat(avgRating))]:"#6b7280" },
                { label:"Reviews analysiert",  val:`${leads.filter(l=>l.reviewsLoaded).length}/${leads.length}`, col:"#4ade80" },
              ].map(s => (
                <div key={s.label} style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"11px 16px", flex:"1 1 130px" }}>
                  <div style={{ fontSize:9, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", marginBottom:5, letterSpacing:"0.07em" }}>{s.label.toUpperCase()}</div>
                  <div style={{ fontSize:20, fontWeight:700, color:s.col, fontFamily:"'IBM Plex Mono',monospace" }}>{s.val}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap", alignItems:"center" }}>
              <span style={{ fontSize:10, color:"#374151", fontFamily:"'IBM Plex Mono',monospace" }}>SORT:</span>
              {[{v:"hot_first",l:"🔥 Hot zuerst"},{v:"rating_asc",l:"↑ Schlechteste"},{v:"rating_desc",l:"↓ Beste"},{v:"reviews_desc",l:"★ Meiste Reviews"}].map(o => (
                <button key={o.v} onClick={() => setSortBy(o.v)}
                  style={{ background:sortBy===o.v?"rgba(59,130,246,0.15)":"rgba(255,255,255,0.03)", border:`1px solid ${sortBy===o.v?"#3b82f6":"rgba(255,255,255,0.07)"}`, color:sortBy===o.v?"#93c5fd":"#4b5563", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"5px 11px", borderRadius:5 }}>{o.l}</button>
              ))}
              <button onClick={() => setFilterHot(!filterHot)}
                style={{ background:filterHot?"rgba(239,68,68,0.12)":"rgba(255,255,255,0.03)", border:`1px solid ${filterHot?"#ef4444":"rgba(255,255,255,0.07)"}`, color:filterHot?"#fca5a5":"#4b5563", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"5px 11px", borderRadius:5, marginLeft:"auto" }}>
                ⚠ Nur Hot Leads ({hotCount})
              </button>
              <button onClick={exportCSV}
                style={{ background:"rgba(22,163,74,0.08)", border:"1px solid rgba(22,163,74,0.25)", color:"#4ade80", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"5px 13px", borderRadius:5 }}>
                ↓ CSV
              </button>
            </div>
          </div>
        )}

        {sorted.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {sorted.map((lead, i) => (
              <div key={lead.placeId || i} className="lead-in" style={{ animationDelay:`${i*0.04}s` }}>
                <LeadCard lead={lead} rank={i+1} reviewing={reviewing.has(lead.placeId)} />
              </div>
            ))}
          </div>
        )}

        {!loading && done && sorted.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 20px", color:"#1f2937" }}>
            <div style={{ fontSize:44, marginBottom:12 }}>📭</div>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12 }}>Keine Leads für aktuelle Filter</div>
          </div>
        )}

        {!loading && !done && !error && (
          <div style={{ textAlign:"center", padding:"64px 20px" }}>
            <div style={{ fontSize:52, marginBottom:14, opacity:.15 }}>♻</div>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, color:"#1f2937", marginBottom:6 }}>Region wählen und Leads suchen</div>
            <div style={{ fontSize:10, color:"#111827", fontFamily:"'IBM Plex Mono',monospace" }}>Google Places · Hunter.io · Apollo.io — alles in einem Tool</div>
          </div>
        )}

        {done && leads.length > 0 && (
          <div style={{ marginTop:22, padding:"12px 16px", background:"rgba(255,255,255,0.015)", border:"1px solid rgba(255,255,255,0.04)", borderRadius:8, fontSize:10, color:"#1f2937", fontFamily:"'IBM Plex Mono',monospace", lineHeight:1.7 }}>
            ✓ Echtzeit via Google Places API · Hunter.io E-Mail-Finder · Apollo.io 1-Klick Deep-Links · Hot Lead = Erreichbarkeits-Signal in Reviews
          </div>
        )}
      </div>
    </>
  );
}
