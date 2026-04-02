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
const HUNTER_THRESHOLD = 85; // Auto-qualify above, manual below

// ─── Utils ────────────────────────────────────────────────────────────────────

function extractDomain(url = "") {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "");
  } catch { return null; }
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

// Derive GF email from Hunter pattern
function deriveGFEmail(gfName, pattern, domain) {
  if (!gfName || !pattern || !domain) return null;
  const parts = gfName.toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].replace(/[äöü]/g, c => ({ ä:"ae",ö:"oe",ü:"ue" })[c] || c);
  const last = parts.slice(1).join("-").replace(/[äöü]/g, c => ({ ä:"ae",ö:"oe",ü:"ue" })[c] || c);
  return pattern
    .replace("{first}", first)
    .replace("{last}", last)
    .replace("{f}", first[0] || "")
    .replace("{l}", last[0] || "") + "@" + domain;
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function apiSearchPlaces(query) {
  const res = await fetch("/api/places-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `Fehler ${res.status}`); }
  return (await res.json()).places || [];
}

async function apiFetchReviews(placeId) {
  const res = await fetch(`/api/places-detail?placeId=${encodeURIComponent(placeId)}`);
  if (!res.ok) return { reviews: [] };
  return res.json();
}

async function apiHunter(domain) {
  const res = await fetch(`/api/hunter?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `Hunter Fehler`); }
  return res.json();
}

async function apiHandelsregister(name) {
  const res = await fetch(`/api/handelsregister?name=${encodeURIComponent(name)}`);
  if (!res.ok) return { geschaeftsfuehrer: [] };
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
  const c = score >= HUNTER_THRESHOLD ? "#22c55e" : score >= 60 ? "#eab308" : "#ef4444";
  const label = score >= HUNTER_THRESHOLD ? "auto ✓" : score >= 60 ? "manuell prüfen" : "unsicher";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:c, display:"inline-block" }}/>
      <span style={{ fontSize:10, color:c, fontFamily:"'IBM Plex Mono',monospace" }}>{score}% {label}</span>
    </span>
  );
}

// Apollo error panel
function ApolloPanel({ name, domain }) {
  const [checked, setChecked] = useState(false);
  const [hasResults, setHasResults] = useState(null);

  const url = apolloPeopleUrl(name, domain);

  const handleOpen = () => {
    window.open(url, "_blank", "noopener");
    setChecked(true);
    // After 4 seconds ask user if results were found
    setTimeout(() => setHasResults("ask"), 4000);
  };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace",
          background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.25)",
          color:"#a78bfa", padding:"2px 8px", borderRadius:3 }}>🔍 APOLLO.IO DEEP-LINKS</span>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {[
          { href: `https://app.apollo.io/#/organizations?q_organization_${domain?"domains":"names"}[]=${encodeURIComponent(domain||name)}`, icon:"🏢", label:"Firma in Apollo suchen", sub: domain||name },
          { onClick: handleOpen, icon:"👤", label:"Geschäftsführer finden", sub:`Titel: Geschäftsführer · ${domain||name}` },
          { href:`https://app.apollo.io/#/people?q_organization_names[]=${encodeURIComponent(name)}&q_person_linkedin_url=true`, icon:"in", label:"LinkedIn-Profile via Apollo", sub:`Personen mit LinkedIn · ${name}` },
        ].map((l, i) => (
          <a key={i}
            href={l.href || "#"}
            onClick={l.onClick ? (e) => { e.preventDefault(); l.onClick(); } : undefined}
            target={l.href ? "_blank" : undefined}
            rel="noopener noreferrer"
            style={{ display:"flex", alignItems:"center", gap:10,
              background:"rgba(139,92,246,0.07)", border:"1px solid rgba(139,92,246,0.2)",
              borderRadius:7, padding:"11px 14px", textDecoration:"none", cursor:"pointer" }}>
            <div style={{ width:32, height:32, background:"rgba(139,92,246,0.15)", borderRadius:6,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{l.icon}</div>
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:"#c4b5fd", marginBottom:2 }}>{l.label}</div>
              <div style={{ fontSize:10, color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace" }}>{l.sub}</div>
            </div>
            <span style={{ marginLeft:"auto", fontSize:14, color:"#7c3aed" }}>→</span>
          </a>
        ))}
      </div>

      {/* Error feedback after opening Apollo */}
      {hasResults === "ask" && (
        <div style={{ marginTop:12, background:"rgba(251,146,60,0.08)", border:"1px solid rgba(251,146,60,0.25)", borderRadius:7, padding:"12px 14px" }}>
          <div style={{ fontSize:12, color:"#fb923c", fontFamily:"'DM Sans',sans-serif", marginBottom:8 }}>
            Hat Apollo Ergebnisse für den Geschäftsführer geliefert?
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setHasResults("yes")}
              style={{ background:"rgba(34,197,94,0.15)", border:"1px solid rgba(34,197,94,0.3)", color:"#4ade80",
                fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"4px 14px", borderRadius:5, cursor:"pointer" }}>
              ✓ Ja
            </button>
            <button onClick={() => setHasResults("no")}
              style={{ background:"rgba(239,68,68,0.15)", border:"1px solid rgba(239,68,68,0.3)", color:"#fca5a5",
                fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"4px 14px", borderRadius:5, cursor:"pointer" }}>
              ✗ Keine Ergebnisse
            </button>
          </div>
        </div>
      )}

      {hasResults === "no" && (
        <div style={{ marginTop:10, background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.25)",
          borderRadius:7, padding:"12px 14px" }}>
          <div style={{ fontSize:12, color:"#ef4444", fontWeight:600, marginBottom:6 }}>
            ⚠ Apollo liefert keine Ergebnisse für diese Firma
          </div>
          <div style={{ fontSize:11, color:"#fca5a5", fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>
            Alternativer Weg: Handelsregister-Tab prüfen → GF-Name ableiten → mit Hunter-Muster E-Mail generieren → manuell eintragen.
            Bei KMU-Betrieben ist info@ oft direkt beim GF — persönliche Ansprache im Betreff erhöht Rücklaufquote deutlich.
          </div>
        </div>
      )}

      {hasResults === "yes" && (
        <div style={{ marginTop:10, background:"rgba(34,197,94,0.07)", border:"1px solid rgba(34,197,94,0.2)",
          borderRadius:7, padding:"10px 14px", fontSize:11, color:"#86efac", fontFamily:"'IBM Plex Mono',monospace" }}>
          ✓ Apollo-Ergebnis gefunden — Daten manuell in Lead übertragen
        </div>
      )}
    </div>
  );
}

function LeadCard({ lead, rank }) {
  const [open, setOpen]   = useState(false);
  const [tab, setTab]     = useState("reviews");
  const isHot  = lead.signals?.length > 0;
  const domain = extractDomain(lead.website || "");

  // Best GF email: from Handelsregister name + Hunter pattern
  const gfEmails = (lead.geschaeftsfuehrer || []).map(gf => ({
    ...gf,
    email: deriveGFEmail(gf.name, lead.hunterPattern, domain),
  })).filter(gf => gf.email);

  // Info email for KMU fallback
  const infoEmail = lead.hunterEmails?.find(e => e.value?.startsWith("info@"));
  const highConfEmails = (lead.hunterEmails || []).filter(e => (e.confidence || 0) >= HUNTER_THRESHOLD);
  const lowConfEmails  = (lead.hunterEmails || []).filter(e => (e.confidence || 0) < HUNTER_THRESHOLD);

  return (
    <div onClick={() => setOpen(!open)}
      style={{ background: isHot ? "rgba(239,68,68,0.04)" : "rgba(255,255,255,0.02)",
        border:`1px solid ${isHot ? "rgba(239,68,68,0.22)" : "rgba(255,255,255,0.07)"}`,
        borderRadius:8, padding:"14px 18px", cursor:"pointer", transition:"border-color .15s" }}>

      {/* Top row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", minWidth:22 }}>#{rank}</span>
            <span style={{ fontSize:15, fontWeight:700, color:"#f9fafb", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:240 }}>
              {lead.name}
            </span>
            {isHot && <span style={{ background:"rgba(239,68,68,0.18)", color:"#ef4444", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 6px", borderRadius:2, letterSpacing:"0.06em", flexShrink:0 }}>🔥 HOT LEAD</span>}
            {lead.geschaeftsfuehrer?.length > 0 && (
              <span style={{ background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.25)", color:"#86efac", fontSize:9, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 6px", borderRadius:2, flexShrink:0 }}>
                👤 {lead.geschaeftsfuehrer[0].name}
              </span>
            )}
          </div>

          <div style={{ display:"flex", flexWrap:"wrap", gap:7, alignItems:"center", marginBottom:5 }}>
            {lead.address && <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>📍 {lead.address}</span>}
            {lead.website && <a href={lead.website} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ fontSize:11, color:"#3b82f6", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>🔗 {domain}</a>}
            {lead.phone && <a href={`tel:${lead.phone}`} onClick={e=>e.stopPropagation()} style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>📞 {lead.phone}</a>}
          </div>

          {/* Hunter pattern badge */}
          {lead.hunterPattern && (
            <div style={{ marginBottom:5 }}>
              <span style={{ background:"rgba(251,146,60,0.1)", border:"1px solid rgba(251,146,60,0.25)", color:"#fb923c", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 8px", borderRadius:3 }}>
                📧 Muster: {lead.hunterPattern}@{domain}
              </span>
            </div>
          )}

          {/* GF derived email */}
          {gfEmails.length > 0 && (
            <div style={{ marginBottom:5 }}>
              <span style={{ background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.2)", color:"#4ade80", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 8px", borderRadius:3 }}>
                ✉ GF: {gfEmails[0].email}
              </span>
            </div>
          )}

          {isHot && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:5 }}>
              {lead.signals.slice(0,4).map((s,i) => (
                <span key={i} style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.35)", color:"#fca5a5", fontSize:10, fontFamily:"'IBM Plex Mono',monospace", padding:"2px 7px", borderRadius:3, whiteSpace:"nowrap" }}>⚠ {s}</span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3, flexShrink:0 }}>
          {lead.rating ? <StarRating rating={lead.rating} /> : <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>–</span>}
          <span style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace" }}>{lead.reviewCount ?? 0} Bew.</span>
          {lead.hunterLoading && <span style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", animation:"pulse 1s infinite" }}>↻ Hunter…</span>}
          {lead.hrLoading && <span style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", animation:"pulse 1s infinite" }}>↻ HR…</span>}
          <span style={{ fontSize:10, color:"#1f2937", marginTop:4 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div style={{ marginTop:14, paddingTop:14, borderTop:"1px solid rgba(255,255,255,0.05)" }} onClick={e=>e.stopPropagation()}>
          {/* Tabs */}
          <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" }}>
            {[
              { id:"reviews",      label:"📋 Reviews" },
              { id:"hunter",       label:`📧 Hunter.io${lead.hunterEmails?.length ? ` (${lead.hunterEmails.length})` : ""}` },
              { id:"handelsreg",   label:`🏛 Handelsregister${lead.geschaeftsfuehrer?.length ? ` (${lead.geschaeftsfuehrer.length})` : ""}` },
              { id:"apollo",       label:"🔍 Apollo" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace",
                  background: tab===t.id ? "rgba(255,255,255,0.07)" : "transparent",
                  border:`1px solid ${tab===t.id ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)"}`,
                  color: tab===t.id ? "#f9fafb" : "#4b5563",
                  padding:"5px 12px", borderRadius:5, cursor:"pointer" }}>{t.label}</button>
            ))}
          </div>

          {/* ── Reviews Tab ── */}
          {tab === "reviews" && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.25)", color:"#86efac", padding:"2px 8px", borderRadius:3 }}>✓ ECHTZEIT · GOOGLE PLACES</span>
                <a href={`https://www.google.com/maps/place/?q=place_id:${lead.placeId}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:"#3b82f6", fontFamily:"'IBM Plex Mono',monospace" }}>→ Maps</a>
              </div>
              {lead.reviewExamples?.length > 0 && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", marginBottom:6 }}>ERREICHBARKEITS-SIGNALE</div>
                  {lead.reviewExamples.map((r,i) => <div key={i} style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.14)", borderRadius:5, padding:"9px 12px", marginBottom:5, fontSize:12, color:"#fca5a5", lineHeight:1.55 }}>„{r}"</div>)}
                </div>
              )}
              {lead.allReviews?.length > 0 && (
                <div>
                  <div style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", marginBottom:6 }}>LETZTE {lead.allReviews.length} GOOGLE REVIEWS</div>
                  {lead.allReviews.map((r,i) => {
                    const txt = r?.text?.text || r?.originalText?.text || "";
                    const rc  = STAR_COLORS[r.rating] || "#6b7280";
                    return (
                      <div key={i} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:5, padding:"9px 12px", marginBottom:5 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, gap:8 }}>
                          <span style={{ fontSize:11, color:"#9ca3af" }}>{r.authorAttribution?.displayName || "Anonym"}</span>
                          <div style={{ display:"flex", gap:2 }}>{[1,2,3,4,5].map(s => <svg key={s} width="10" height="10" viewBox="0 0 24 24" fill={s<=(r.rating||0)?rc:"#1f2937"}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>)}</div>
                        </div>
                        <div style={{ fontSize:12, color:"#6b7280", lineHeight:1.5 }}>{txt.slice(0,220)}{txt.length>220?"…":""}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!lead.allReviews?.length && <div style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace" }}>Keine öffentlichen Reviews verfügbar.</div>}
            </div>
          )}

          {/* ── Hunter Tab ── */}
          {tab === "hunter" && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
                <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(251,146,60,0.1)", border:"1px solid rgba(251,146,60,0.25)", color:"#fb923c", padding:"2px 8px", borderRadius:3 }}>📧 HUNTER.IO · AUTOMATISCH</span>
                {domain && <span style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>{domain}</span>}
                {lead.hunterPattern && (
                  <span style={{ fontSize:10, background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.25)", color:"#93c5fd", padding:"2px 8px", borderRadius:3, fontFamily:"'IBM Plex Mono',monospace" }}>
                    Muster: {lead.hunterPattern}@{domain}
                  </span>
                )}
              </div>

              {lead.hunterLoading && <div style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", animation:"pulse 1s infinite" }}>↻ Hunter.io durchsucht {domain}…</div>}
              {lead.hunterError && <div style={{ padding:"8px 10px", background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:5, fontSize:11, color:"#fca5a5", fontFamily:"'IBM Plex Mono',monospace" }}>✗ {lead.hunterError}</div>}

              {/* GF abgeleitete Emails */}
              {gfEmails.length > 0 && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:10, color:"#4ade80", fontFamily:"'IBM Plex Mono',monospace", marginBottom:6 }}>✓ GESCHÄFTSFÜHRER EMAIL (ABGELEITET)</div>
                  {gfEmails.map((gf, i) => (
                    <div key={i} style={{ background:"rgba(34,197,94,0.06)", border:"1px solid rgba(34,197,94,0.2)", borderRadius:5, padding:"9px 12px", marginBottom:5, display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                      <div>
                        <div style={{ fontSize:11, color:"#9ca3af", marginBottom:2 }}>{gf.name} · {gf.rolle}</div>
                        <a href={`mailto:${gf.email}`} style={{ fontSize:12, color:"#4ade80", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>{gf.email}</a>
                      </div>
                      <span style={{ fontSize:10, color:"#4ade80", fontFamily:"'IBM Plex Mono',monospace" }}>HR-Ableitung</span>
                    </div>
                  ))}
                </div>
              )}

              {/* High confidence emails */}
              {highConfEmails.length > 0 && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", marginBottom:6 }}>AUTO-QUALIFIZIERT ≥ {HUNTER_THRESHOLD}%</div>
                  {highConfEmails.map((e, i) => (
                    <div key={i} style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:5, padding:"7px 10px", marginBottom:5, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <div style={{ flex:1 }}>
                        {e.first_name && <div style={{ fontSize:11, color:"#9ca3af", marginBottom:2 }}>{e.first_name} {e.last_name}{e.position ? ` · ${e.position}` : ""}</div>}
                        <a href={`mailto:${e.value}`} style={{ fontSize:12, color:"#60a5fa", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>{e.value}</a>
                      </div>
                      <ConfidenceDot score={e.confidence || 0} />
                    </div>
                  ))}
                </div>
              )}

              {/* Low confidence — manual decision */}
              {lowConfEmails.length > 0 && (
                <div>
                  <div style={{ fontSize:10, color:"#f97316", fontFamily:"'IBM Plex Mono',monospace", marginBottom:6 }}>⚠ MANUELLE ENTSCHEIDUNG &lt; {HUNTER_THRESHOLD}%</div>
                  {lowConfEmails.map((e, i) => (
                    <div key={i} style={{ background:"rgba(249,115,22,0.04)", border:"1px solid rgba(249,115,22,0.15)", borderRadius:5, padding:"7px 10px", marginBottom:5, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <div style={{ flex:1 }}>
                        {e.first_name && <div style={{ fontSize:11, color:"#9ca3af", marginBottom:2 }}>{e.first_name} {e.last_name}{e.position ? ` · ${e.position}` : ""}</div>}
                        <a href={`mailto:${e.value}`} style={{ fontSize:12, color:"#fb923c", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>{e.value}</a>
                      </div>
                      <ConfidenceDot score={e.confidence || 0} />
                    </div>
                  ))}
                </div>
              )}

              {/* KMU Info-Mail Hinweis */}
              {infoEmail && gfEmails.length === 0 && (
                <div style={{ marginTop:10, background:"rgba(59,130,246,0.07)", border:"1px solid rgba(59,130,246,0.2)", borderRadius:6, padding:"10px 12px" }}>
                  <div style={{ fontSize:11, color:"#93c5fd", fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>
                    💡 <strong>KMU-Tipp:</strong> Bei kleinen Betrieben landet info@ oft direkt beim GF. GF-Namen aus Handelsregister-Tab entnehmen und persönlich im Betreff ansprechen.
                  </div>
                </div>
              )}

              {!lead.hunterLoading && !lead.hunterEmails?.length && !lead.hunterError && (
                <div style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace" }}>Keine E-Mail-Adressen für diese Domain gefunden.</div>
              )}
            </div>
          )}

          {/* ── Handelsregister Tab ── */}
          {tab === "handelsreg" && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.25)", color:"#86efac", padding:"2px 8px", borderRadius:3 }}>🏛 OFFENES HANDELSREGISTER · KOSTENLOS</span>
                <span style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>offeneregister.de</span>
              </div>

              {lead.hrLoading && <div style={{ fontSize:11, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", animation:"pulse 1s infinite" }}>↻ Handelsregister wird durchsucht…</div>}

              {lead.geschaeftsfuehrer?.length > 0 ? (
                <div>
                  <div style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", marginBottom:8 }}>GEFUNDENE ENTSCHEIDER</div>
                  {lead.geschaeftsfuehrer.map((gf, i) => {
                    const derivedEmail = deriveGFEmail(gf.name, lead.hunterPattern, domain);
                    return (
                      <div key={i} style={{ background:"rgba(34,197,94,0.05)", border:"1px solid rgba(34,197,94,0.18)", borderRadius:6, padding:"10px 14px", marginBottom:8 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:"#f9fafb", marginBottom:3 }}>👤 {gf.name}</div>
                        <div style={{ fontSize:11, color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace", marginBottom: derivedEmail ? 6 : 0 }}>{gf.rolle}</div>
                        {derivedEmail && (
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <a href={`mailto:${derivedEmail}`} style={{ fontSize:12, color:"#4ade80", fontFamily:"'IBM Plex Mono',monospace", textDecoration:"none" }}>{derivedEmail}</a>
                            <span style={{ fontSize:9, color:"#4ade80", fontFamily:"'IBM Plex Mono',monospace", background:"rgba(34,197,94,0.1)", padding:"1px 5px", borderRadius:2 }}>abgeleitet</span>
                          </div>
                        )}
                        {!derivedEmail && lead.hunterPattern && (
                          <div style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace" }}>
                            Muster vorhanden — Email-Ableitung prüfen
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                !lead.hrLoading && (
                  <div style={{ fontSize:11, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", lineHeight:1.6 }}>
                    Kein Eintrag im offenen Handelsregister gefunden.<br/>
                    Manuell prüfen: <a href={`https://www.handelsregister.de/rp_web/mask.do?Typ=s&Registergericht=&Registerart=&Registernummer=&Schlagwoerter=${encodeURIComponent(lead.name)}&SchlagwoerterOptionen=1`} target="_blank" rel="noopener noreferrer" style={{ color:"#3b82f6" }}>handelsregister.de →</a>
                  </div>
                )
              )}
            </div>
          )}

          {/* ── Apollo Tab ── */}
          {tab === "apollo" && <ApolloPanel name={lead.name} domain={domain} />}
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
  const [progress,  setProgress]  = useState({ done:0, total:0, phase:"" });
  const [error,     setError]     = useState("");
  const [sortBy,    setSortBy]    = useState("hot_first");
  const [activeTab, setActiveTab] = useState("primary"); // "primary" | "second"
  const [done,      setDone]      = useState(false);
  const abortRef = useRef(false);
  const effectiveRegion = custom || region;

  const runSearch = useCallback(async () => {
    if (!effectiveRegion) return;
    abortRef.current = false;
    setLoading(true); setLeads([]); setDone(false); setError("");
    setProgress({ done:0, total:0, phase:"Suche Containerdienste…" });

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
        hunterEmails:[], hunterPattern:null, hunterLoading:false, hunterError:null, hunterDone:false,
        geschaeftsfuehrer:[], hrLoading:false, hrDone:false,
      }));
      setLeads(initial);
      setProgress({ done:0, total:initial.length, phase:"Analysiere Reviews, Hunter.io & Handelsregister…" });

      // Process each company — Reviews + Hunter + Handelsregister in parallel
      for (let i = 0; i < initial.length; i++) {
        if (abortRef.current) break;
        const lead = initial[i];

        // Mark as loading
        initial[i] = { ...lead, hunterLoading:true, hrLoading:true };
        setLeads([...initial]);

        const domain = extractDomain(lead.website || "");

        // Run all three in parallel
        const [reviewRes, hunterRes, hrRes] = await Promise.allSettled([
          apiFetchReviews(lead.placeId),
          domain ? apiHunter(domain) : Promise.resolve(null),
          apiHandelsregister(lead.name),
        ]);

        // Process reviews
        let signals = [], reviewExamples = [], allReviews = [], rating = lead.rating, reviewCount = lead.reviewCount;
        if (reviewRes.status === "fulfilled" && reviewRes.value) {
          const rv = reviewRes.value;
          rating = rv.rating ?? lead.rating;
          reviewCount = rv.reviewCount ?? lead.reviewCount;
          allReviews = rv.reviews || [];
          const det = detectQualSignals(allReviews);
          signals = det.signals;
          reviewExamples = det.examples;
        }

        // Process Hunter
        let hunterEmails = [], hunterPattern = null, hunterError = null;
        if (hunterRes.status === "fulfilled" && hunterRes.value) {
          const hd = hunterRes.value;
          hunterEmails = hd.emails || [];
          hunterPattern = hd.pattern || null;
        } else if (hunterRes.status === "rejected") {
          hunterError = hunterRes.reason?.message || "Hunter Fehler";
        }

        // Process Handelsregister
        let geschaeftsfuehrer = [];
        if (hrRes.status === "fulfilled" && hrRes.value) {
          geschaeftsfuehrer = hrRes.value.geschaeftsfuehrer || [];
        }

        initial[i] = {
          ...lead,
          rating, reviewCount, signals, reviewExamples, allReviews, reviewsLoaded:true,
          hunterEmails, hunterPattern, hunterLoading:false, hunterError, hunterDone:true,
          geschaeftsfuehrer, hrLoading:false, hrDone:true,
        };
        setLeads([...initial]);
        setProgress({ done:i+1, total:initial.length, phase:"Analysiere…" });
        if (i < initial.length - 1) await new Promise(r => setTimeout(r, 200));
      }

      setDone(true);
    } catch (e) { setError(e.message || "Fehler — bitte Administrator kontaktieren."); }
    finally { setLoading(false); setProgress({ done:0, total:0, phase:"" }); }
  }, [effectiveRegion]);

  // Split leads: primary = has Hunter pattern, secondary = no pattern or all <85%
  const hasPattern = (l) => !!l.hunterPattern || (l.hunterEmails || []).some(e => (e.confidence||0) >= HUNTER_THRESHOLD);
  const primaryLeads   = leads.filter(l => l.hunterDone && hasPattern(l));
  const secondaryLeads = leads.filter(l => l.hunterDone && !hasPattern(l));
  const pendingLeads   = leads.filter(l => !l.hunterDone); // still loading

  const sortLeads = (arr) => [...arr].sort((a, b) => {
    if (sortBy === "hot_first") { const d = (b.signals?.length||0)-(a.signals?.length||0); return d || ((a.rating??5)-(b.rating??5)); }
    if (sortBy === "rating_asc")  return (a.rating??5)-(b.rating??5);
    if (sortBy === "rating_desc") return (b.rating??0)-(a.rating??0);
    return 0;
  });

  const displayPrimary   = sortLeads(primaryLeads);
  const displaySecondary = sortLeads(secondaryLeads);
  const hotCount = primaryLeads.filter(l => l.signals?.length > 0).length;
  const rated    = leads.filter(l => l.rating);
  const avgRating = rated.length ? (rated.reduce((s,l)=>s+l.rating,0)/rated.length).toFixed(1) : null;

  const exportCSV = (arr, filename) => {
    const h = ["#","Firma","Adresse","Bewertung","Reviews","Website","Telefon","Hot Lead","Signale","GF Name","GF Email","Hunter Muster","Höchste Konfidenz","Review-Zitat"];
    const rows = arr.map((l, i) => {
      const domain = extractDomain(l.website || "");
      const gf = l.geschaeftsfuehrer?.[0];
      const gfEmail = gf ? deriveGFEmail(gf.name, l.hunterPattern, domain) : "";
      const bestConf = Math.max(0, ...(l.hunterEmails||[]).map(e=>e.confidence||0));
      const bestEmail = l.hunterEmails?.find(e=>(e.confidence||0)===bestConf)?.value || "";
      return [
        i+1, `"${l.name}"`, `"${l.address}"`, l.rating??"", l.reviewCount??0,
        `"${l.website||""}"`, `"${l.phone||""}"`,
        l.signals?.length>0?"JA":"NEIN",
        `"${(l.signals||[]).join("; ")}"`,
        `"${gf?.name||""}"`,
        gfEmail ? `"=HYPERLINK(""mailto:${gfEmail}"",""${gfEmail}"")"` : '""',
        `"${l.hunterPattern ? l.hunterPattern+"@"+domain : ""}"`,
        bestEmail ? `"=HYPERLINK(""mailto:${bestEmail}"",""${bestEmail} (${bestConf}%)"")"`  : '""',
        `"${(l.reviewExamples?.[0]||"").replace(/"/g,"'")}"`,
      ];
    });
    const csv = [h, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8;" }));
    a.download = filename;
    a.click();
  };

  return (
    <>
      <Head>
        <title>wAIste Lead Finder</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>♻</text></svg>" />
      </Head>

      <div style={{ minHeight:"100vh", background:"#07090f" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
          *{box-sizing:border-box;margin:0;padding:0}
          body{background:#07090f;color:#f9fafb;font-family:'DM Sans',sans-serif}
          ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1f2937;border-radius:2px}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
          @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
          @keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}
          .lead-in{animation:slideUp .22s ease both}
          input:focus,select:focus{outline:none;border-color:rgba(59,130,246,0.45)!important}
          button,a{transition:opacity .12s}button:hover,a:hover{opacity:.82}
        `}</style>

        {/* Header */}
        <div style={{ background:"linear-gradient(180deg,#0d1117 0%,#07090f 100%)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"20px 28px 18px", position:"sticky", top:0, zIndex:50 }}>
          <div style={{ maxWidth:960, margin:"0 auto", display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:38, height:38, borderRadius:9, background:"linear-gradient(135deg,#16a34a,#0f6b2e)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>♻</div>
            <div>
              <div style={{ fontSize:19, fontWeight:700, color:"#f9fafb", letterSpacing:"-0.02em" }}>
                wAIste <span style={{ color:"#16a34a" }}>Lead Finder</span>
                <span style={{ marginLeft:10, fontSize:9, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(34,197,94,0.15)", border:"1px solid rgba(34,197,94,0.3)", color:"#86efac", padding:"2px 7px", borderRadius:3, verticalAlign:"middle" }}>LIVE</span>
              </div>
              <div style={{ fontSize:10, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.06em", marginTop:2 }}>
                GOOGLE PLACES · HUNTER.IO AUTO · HANDELSREGISTER · APOLLO.IO
              </div>
            </div>
          </div>
        </div>

        <div style={{ maxWidth:960, margin:"0 auto", padding:"22px 28px 48px" }}>

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
                style={{ background: loading?"#14532d":!effectiveRegion?"#141a12":"#15803d", color:"#fff", border:"none", borderRadius:6, padding:"9px 20px", fontSize:13, fontWeight:600, cursor:loading||!effectiveRegion?"not-allowed":"pointer", whiteSpace:"nowrap", opacity:!effectiveRegion?0.4:1 }}>
                {loading ? <span style={{ animation:"pulse 1s infinite" }}>⟳ Suche…</span> : "🔍 Leads suchen"}
              </button>
              {loading && <button onClick={() => { abortRef.current=true; }} style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)", color:"#fca5a5", borderRadius:6, padding:"9px 14px", fontSize:12, fontFamily:"'IBM Plex Mono',monospace", cursor:"pointer" }}>✕</button>}
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

          {/* Skeleton */}
          {loading && leads.length === 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {[...Array(8)].map((_,i) => <div key={i} style={{ height:88, borderRadius:8, background:"linear-gradient(90deg,rgba(255,255,255,0.02) 25%,rgba(255,255,255,0.05) 50%,rgba(255,255,255,0.02) 75%)", backgroundSize:"600px 100%", animation:`shimmer 1.4s ${i*0.07}s infinite linear` }}/>)}
            </div>
          )}

          {/* Stats */}
          {leads.length > 0 && (
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
              {[
                { label:"Primäre Leads",     val:primaryLeads.length,   col:"#f9fafb" },
                { label:"Hot Leads 🔥",      val:hotCount,              col:"#ef4444" },
                { label:"Second Choice",     val:secondaryLeads.length, col:"#f97316" },
                { label:"Ø Bewertung",       val:avgRating?`${avgRating} ★`:"–", col:avgRating?STAR_COLORS[Math.round(parseFloat(avgRating))]:"#6b7280" },
                { label:"Analysiert",        val:`${leads.filter(l=>l.hunterDone).length}/${leads.length}`, col:"#4ade80" },
              ].map(s => (
                <div key={s.label} style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"11px 16px", flex:"1 1 120px" }}>
                  <div style={{ fontSize:9, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", marginBottom:5, letterSpacing:"0.07em" }}>{s.label.toUpperCase()}</div>
                  <div style={{ fontSize:20, fontWeight:700, color:s.col, fontFamily:"'IBM Plex Mono',monospace" }}>{s.val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tab bar + controls */}
          {leads.length > 0 && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginBottom:16 }}>
              {/* Primary / Secondary tabs */}
              <button onClick={() => setActiveTab("primary")}
                style={{ background: activeTab==="primary"?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.03)", border:`1px solid ${activeTab==="primary"?"#16a34a":"rgba(255,255,255,0.07)"}`, color: activeTab==="primary"?"#4ade80":"#4b5563", fontSize:12, fontFamily:"'IBM Plex Mono',monospace", padding:"6px 14px", borderRadius:6, cursor:"pointer" }}>
                ✓ Lead Finder ({primaryLeads.length})
              </button>
              <button onClick={() => setActiveTab("second")}
                style={{ background: activeTab==="second"?"rgba(249,115,22,0.15)":"rgba(255,255,255,0.03)", border:`1px solid ${activeTab==="second"?"#f97316":"rgba(255,255,255,0.07)"}`, color: activeTab==="second"?"#fb923c":"#4b5563", fontSize:12, fontFamily:"'IBM Plex Mono',monospace", padding:"6px 14px", borderRadius:6, cursor:"pointer" }}>
                ⚠ Second Choice Leads ({secondaryLeads.length})
              </button>

              <span style={{ fontSize:10, color:"#374151", fontFamily:"'IBM Plex Mono',monospace", marginLeft:8 }}>SORT:</span>
              {[{v:"hot_first",l:"🔥 Hot"},{v:"rating_asc",l:"↑ Schlechteste"},{v:"rating_desc",l:"↓ Beste"}].map(o => (
                <button key={o.v} onClick={() => setSortBy(o.v)}
                  style={{ background:sortBy===o.v?"rgba(59,130,246,0.15)":"rgba(255,255,255,0.03)", border:`1px solid ${sortBy===o.v?"#3b82f6":"rgba(255,255,255,0.07)"}`, color:sortBy===o.v?"#93c5fd":"#4b5563", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"5px 11px", borderRadius:5, cursor:"pointer" }}>{o.l}</button>
              ))}

              <button onClick={() => exportCSV(activeTab==="primary"?displayPrimary:displaySecondary, `waiste-${activeTab==="primary"?"primary":"second"}-leads-${effectiveRegion}-${new Date().toISOString().slice(0,10)}.csv`)}
                style={{ background:"rgba(22,163,74,0.08)", border:"1px solid rgba(22,163,74,0.25)", color:"#4ade80", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", padding:"5px 13px", borderRadius:5, cursor:"pointer", marginLeft:"auto" }}>
                ↓ CSV ({activeTab==="primary"?"Primär":"Second Choice"})
              </button>
            </div>
          )}

          {/* Second Choice explanation */}
          {activeTab === "second" && secondaryLeads.length > 0 && (
            <div style={{ marginBottom:14, padding:"12px 16px", background:"rgba(249,115,22,0.06)", border:"1px solid rgba(249,115,22,0.2)", borderRadius:8, fontSize:11, color:"#fb923c", fontFamily:"'DM Sans',sans-serif", lineHeight:1.6 }}>
              ⚠ <strong>Second Choice Leads</strong> — Hunter.io hat für diese Firmen kein E-Mail-Muster gefunden oder alle Adressen liegen unter {HUNTER_THRESHOLD}% Konfidenz. Manuell über Handelsregister + Apollo entscheiden.
            </div>
          )}

          {/* Lead cards — Primary */}
          {activeTab === "primary" && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {displayPrimary.map((lead, i) => (
                <div key={lead.placeId||i} className="lead-in" style={{ animationDelay:`${i*0.04}s` }}>
                  <LeadCard lead={lead} rank={i+1} />
                </div>
              ))}
              {/* Still loading — pending cards */}
              {pendingLeads.map((lead, i) => (
                <div key={lead.placeId||`p${i}`} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"14px 18px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:13, color:"#f9fafb" }}>{lead.name}</span>
                    <span style={{ fontSize:10, color:"#4b5563", fontFamily:"'IBM Plex Mono',monospace", animation:"pulse 1s infinite" }}>↻ analysiere…</span>
                  </div>
                </div>
              ))}
              {done && displayPrimary.length === 0 && <div style={{ textAlign:"center", padding:"40px 20px", color:"#374151", fontFamily:"'IBM Plex Mono',monospace", fontSize:12 }}>Keine primären Leads mit E-Mail-Muster gefunden — Second Choice prüfen.</div>}
            </div>
          )}

          {/* Lead cards — Second Choice */}
          {activeTab === "second" && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {displaySecondary.map((lead, i) => (
                <div key={lead.placeId||i} className="lead-in" style={{ animationDelay:`${i*0.04}s` }}>
                  <LeadCard lead={lead} rank={i+1} />
                </div>
              ))}
              {done && displaySecondary.length === 0 && <div style={{ textAlign:"center", padding:"40px 20px", color:"#374151", fontFamily:"'IBM Plex Mono',monospace", fontSize:12 }}>Alle Leads haben E-Mail-Muster — keine Second Choice Leads.</div>}
            </div>
          )}

          {/* Initial */}
          {!loading && !done && !error && (
            <div style={{ textAlign:"center", padding:"64px 20px" }}>
              <div style={{ fontSize:52, marginBottom:14, opacity:.15 }}>♻</div>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, color:"#1f2937", marginBottom:6 }}>Region wählen → automatische Analyse startet</div>
              <div style={{ fontSize:10, color:"#111827", fontFamily:"'IBM Plex Mono',monospace" }}>
                Google Places · Hunter.io Auto · Handelsregister · Apollo · GF-Email-Ableitung
              </div>
            </div>
          )}

          {/* Footer */}
          {done && (
            <div style={{ marginTop:22, padding:"12px 16px", background:"rgba(255,255,255,0.015)", border:"1px solid rgba(255,255,255,0.04)", borderRadius:8, fontSize:10, color:"#1f2937", fontFamily:"'IBM Plex Mono',monospace", lineHeight:1.7 }}>
              ✓ Primäre Leads = Hunter-Muster ≥{HUNTER_THRESHOLD}% · Second Choice = kein Muster oder &lt;{HUNTER_THRESHOLD}% · GF via offeneregister.de · Email-Ableitung automatisch · CSV mit mailto-Links
            </div>
          )}
        </div>
      </div>
    </>
  );
}
