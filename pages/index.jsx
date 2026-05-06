import { useState, useCallback, useRef } from "react";
import Head from "next/head";

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIONS = [
  "Berlin","Hamburg","München","Köln","Frankfurt am Main","Stuttgart",
  "Düsseldorf","Dortmund","Essen","Leipzig","Bremen","Dresden","Hannover",
  "Nürnberg","Duisburg","Bochum","Wuppertal","Bielefeld","Bonn","Münster",
  "Karlsruhe","Mannheim","Augsburg","Wiesbaden","Gelsenkirchen","Mönchengladbach",
  "Braunschweig","Kiel","Chemnitz","Aachen","Halle (Saale)","Magdeburg",
  "Freiburg im Breisgau","Krefeld","Lübeck","Oberhausen","Erfurt","Mainz",
  "Rostock","Kassel",
];

const QUAL_KEYWORDS = [
  "kein rückruf","nicht erreichbar","telefon besetzt","niemand abgehoben",
  "keiner meldet sich","keine antwort","schlechte erreichbarkeit",
  "anrufbeantworter","nicht zurückgerufen","niemand geht ran",
  "nicht ans telefon","warteschleife","kein ansprechpartner",
  "meldet sich nicht","geht nicht ran","mehrmals angerufen",
  "nochmal angerufen","kommt nie","nicht gemeldet",
];

const STAR_COLORS = { 1:"#ef4444",2:"#f97316",3:"#eab308",4:"#84cc16",5:"#22c55e" };

// ICP Classification — layered approach since Hunter headcount is rarely available for German SMBs
// Priority: 1) Hunter headcount  2) Legal form in company name  3) Google review count proxy
const SMALL_NAME_SIGNALS = ["inh.","inhaber","e.k.","einzeluntern","einzelkaufm","familienbetrieb"];
const LARGE_NAME_SIGNALS  = ["holding","gruppe","group","gmbh & co","ag ","aktiengesellschaft"];

function classifySize(lead, headcount) {
  // 1. Hunter headcount (when available — rare for German SMBs but most accurate)
  if (headcount) {
    const h = headcount.toLowerCase().replace(/_/g,"-");
    if (h.startsWith("1-10") || h.startsWith("11-50")) return "small";
    return "large";
  }
  // 2. Legal form / company name signals
  const nl = (lead.name||"").toLowerCase();
  if (LARGE_NAME_SIGNALS.some(s=>nl.includes(s))) return "large";
  if (SMALL_NAME_SIGNALS.some(s=>nl.includes(s))) return "small";
  // 3. Google review count proxy (reliable, always available)
  // More reviews = more established = likely larger operation
  const rc = lead.reviewCount || 0;
  if (rc === 0) return "small";         // No reviews = tiny operation
  if (rc <= 30) return "small";         // Up to 30 reviews → likely 1-20 employees
  return "large";                       // 31+ reviews → likely 21+ employees
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function extractDomain(url="") {
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
  const p = new URLSearchParams();
  if (domain) p.set("q_organization_domains[]", domain);
  else p.set("q_organization_names[]", name);
  p.set("q_person_titles[]", "Geschäftsführer");
  return `https://app.apollo.io/#/people?${p.toString()}`;
}

function detectQualSignals(reviews=[]) {
  const signals = new Set(); const examples = [];
  for (const rev of reviews) {
    const text = (rev?.text?.text || rev?.originalText?.text || "").toLowerCase();
    if (!text) continue;
    for (const kw of QUAL_KEYWORDS) {
      if (text.includes(kw)) {
        signals.add(kw.charAt(0).toUpperCase()+kw.slice(1));
        const full = rev?.text?.text || rev?.originalText?.text || "";
        if (examples.length<3 && !examples.includes(full))
          examples.push(full.length>180 ? full.slice(0,180)+"…" : full);
      }
    }
  }
  return { signals:[...signals], examples };
}

function avgConfidence(emails=[]) {
  if (!emails.length) return 0;
  return Math.round(emails.reduce((s,e)=>s+(e.confidence||0),0)/emails.length);
}

function deriveGfEmail(gfName, pattern, domain) {
  if (!gfName || !pattern || !domain) return null;
  const parts = gfName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].toLowerCase().replace(/[^a-z]/g,"");
  const last  = parts[parts.length-1].toLowerCase().replace(/[^a-z]/g,"");
  return pattern
    .replace("{first}", first)
    .replace("{last}", last)
    .replace("{f}", first[0]||"")
    .replace("{l}", last[0]||"")
    + "@" + domain;
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function apiSearchPlaces(query) {
  const r = await fetch("/api/places-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query})});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||`Fehler ${r.status}`);}
  return (await r.json()).places||[];
}

async function apiFetchReviews(placeId) {
  const r = await fetch(`/api/places-detail?placeId=${encodeURIComponent(placeId)}`);
  if(!r.ok) return {reviews:[]};
  return r.json();
}

async function apiHunter(domain) {
  const r = await fetch(`/api/hunter?domain=${encodeURIComponent(domain)}`);
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"Hunter Fehler");}
  return r.json();
}

async function apiHandelsregister(name) {
  const r = await fetch(`/api/handelsregister?name=${encodeURIComponent(name)}`);
  if(!r.ok) return {geschaeftsfuehrer:[],found:false};
  return r.json();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRating({rating}) {
  const c = STAR_COLORS[Math.round(rating)]||"#6b7280";
  return (
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      {[1,2,3,4,5].map(s=>(
        <svg key={s} width="13" height="13" viewBox="0 0 24 24" fill={s<=Math.round(rating)?c:"#1f2937"}>
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
        </svg>
      ))}
      <span style={{color:c,fontSize:13,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{rating?.toFixed(1)??"–"}</span>
    </div>
  );
}

function ConfidencePill({score}) {
  const c = score>=85?"#22c55e":score>=60?"#eab308":"#ef4444";
  const label = score>=85?"✓ hoch":score>=60?"~ mittel":"✗ niedrig";
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,
      background:`${c}18`,border:`1px solid ${c}44`,
      color:c,fontSize:10,fontFamily:"'IBM Plex Mono',monospace",
      padding:"2px 7px",borderRadius:3}}>
      {score}% {label}
    </span>
  );
}

function ApolloButton({lead}) {
  const [warned,setWarned] = useState(false);
  const domain = extractDomain(lead.website||"");
  const hasEnoughData = !!(domain || lead.name);

  const handleClick = (e,type) => {
    e.stopPropagation();
    if (!hasEnoughData) { setWarned(true); return; }
    const url = type==="org" ? apolloOrgUrl(lead.name,domain) : apolloPeopleUrl(lead.name,domain);
    window.open(url,"_blank","noopener");
  };

  return (
    <div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
        <button onClick={e=>handleClick(e,"people")}
          style={{background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.25)",
            color:"#a78bfa",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
            padding:"4px 10px",borderRadius:5}}>
          👤 GF suchen →
        </button>
        <button onClick={e=>handleClick(e,"org")}
          style={{background:"rgba(139,92,246,0.05)",border:"1px solid rgba(139,92,246,0.15)",
            color:"#7c3aed",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
            padding:"4px 10px",borderRadius:5}}>
          🏢 Firma →
        </button>
      </div>
      {warned && (
        <div style={{marginTop:8,padding:"8px 12px",
          background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",
          borderRadius:6,fontSize:11,color:"#fca5a5",fontFamily:"'IBM Plex Mono',monospace"}}>
          ⚠ Kein Ergebnis zu erwarten — keine Website oder Firmenname für Apollo-Suche verfügbar.
          <button onClick={e=>{e.stopPropagation();setWarned(false);}}
            style={{marginLeft:8,background:"none",border:"none",color:"#6b7280",fontSize:10,cursor:"pointer"}}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function LeadCard({lead,rank,toggleSize}) {
  const [open,setOpen]   = useState(false);
  const [tab,setTab]     = useState("reviews");
  const isHot = lead.signals?.length>0;
  const domain = extractDomain(lead.website||"");
  const effectiveSize_ = lead.sizeOverride || lead.sizeClass || "small";
  const avgConf = lead.hunterEmails ? avgConfidence(lead.hunterEmails) : 0;
  const hasPattern = !!(lead.hunterPattern);
  const gfEmail = lead.gfDerived || null;

  const infoEmailOnly = !lead.hunterEmails?.some(e=>!e.value?.startsWith("info@")&&!e.value?.startsWith("kontakt@")&&!e.value?.startsWith("mail@"));
  const isKmu = lead.isKmu;

  return (
    <div onClick={()=>setOpen(!open)}
      style={{background:isHot?"rgba(239,68,68,0.04)":"rgba(255,255,255,0.02)",
        border:`1px solid ${isHot?"rgba(239,68,68,0.22)":"rgba(255,255,255,0.07)"}`,
        borderRadius:8,padding:"14px 18px",cursor:"pointer",transition:"border-color .15s"}}>

      {/* Top row */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div style={{flex:1,minWidth:0}}>

          {/* Name + badges */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",minWidth:22}}>#{rank}</span>
            <span style={{fontSize:15,fontWeight:700,color:"#f9fafb",overflow:"hidden",
              textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:260,fontFamily:"'DM Sans',sans-serif"}}>
              {lead.name}
            </span>
            {isHot && <span style={{background:"rgba(239,68,68,0.18)",color:"#ef4444",fontSize:9,
              fontFamily:"'IBM Plex Mono',monospace",padding:"2px 6px",borderRadius:2,letterSpacing:"0.06em",flexShrink:0}}>
              🔥 HOT LEAD</span>}
            {/* ICP Size badge + manual toggle */}
            <button
              onClick={e=>{e.stopPropagation();if(toggleSize)toggleSize(lead.placeId);}}
              title={`Klassifizierung: ${lead.sizeReason||"automatisch"} — klicken zum Umschalten`}
              style={{display:"flex",alignItems:"center",gap:3,
                background:effectiveSize_=="small"?"rgba(59,130,246,0.12)":"rgba(139,92,246,0.12)",
                border:`1px solid ${effectiveSize_==="small"?"rgba(59,130,246,0.3)":"rgba(139,92,246,0.3)"}`,
                color:effectiveSize_==="small"?"#93c5fd":"#a78bfa",
                fontSize:9,fontFamily:"'IBM Plex Mono',monospace",
                padding:"2px 6px",borderRadius:2,flexShrink:0,cursor:"pointer"}}>
              {effectiveSize_==="small"?"👥 1–20 MA":"🏭 21+ MA"}
              {lead.sizeOverride && <span style={{marginLeft:2,opacity:0.6}}>✏</span>}
            </button>
            {lead.hunterLoading && <span style={{fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",animation:"pulse 1s infinite"}}>↻ Hunter…</span>}
            {lead.hrLoading && <span style={{fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",animation:"pulse 1s infinite"}}>↻ HR…</span>}
          </div>

          {/* Geschäftsführer from Handelsregister */}
          {lead.geschaeftsfuehrer?.length>0 && (
            <div style={{marginBottom:5,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <span style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>GF:</span>
              {lead.geschaeftsfuehrer.map((gf,i)=>(
                <span key={i} style={{fontSize:12,color:"#d1d5db",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>
                  {gf.name}
                  {gfEmail && i===0 && (
                    <a href={`mailto:${gfEmail}`} onClick={e=>e.stopPropagation()}
                      style={{marginLeft:6,fontSize:11,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>
                      {gfEmail}
                    </a>
                  )}
                </span>
              ))}
              {lead.gfDerived && (
                <span style={{fontSize:9,background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.25)",
                  color:"#86efac",fontFamily:"'IBM Plex Mono',monospace",padding:"1px 5px",borderRadius:2}}>
                  ABGELEITET
                </span>
              )}
            </div>
          )}

          {/* Meta */}
          <div style={{display:"flex",flexWrap:"wrap",gap:7,alignItems:"center",marginBottom:6}}>
            {lead.address && <span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>📍 {lead.address}</span>}
            {lead.website && <a href={lead.website} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
              style={{fontSize:11,color:"#3b82f6",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>
              🔗 {domain}</a>}
            {lead.phone && <a href={`tel:${lead.phone}`} onClick={e=>e.stopPropagation()}
              style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>
              📞 {lead.phone}</a>}
            {hasPattern && <span style={{fontSize:10,background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.25)",
              color:"#fb923c",fontFamily:"'IBM Plex Mono',monospace",padding:"2px 6px",borderRadius:3}}>
              📧 {lead.hunterPattern}@{domain}</span>}
            {avgConf>0 && <ConfidencePill score={avgConf}/>}
          </div>

          {/* KMU info@-Hinweis */}
          {isKmu && infoEmailOnly && lead.hunterEmails?.length>0 && (
            <div style={{marginBottom:6,padding:"5px 10px",background:"rgba(59,130,246,0.07)",
              border:"1px solid rgba(59,130,246,0.2)",borderRadius:5,fontSize:11,
              color:"#93c5fd",fontFamily:"'IBM Plex Mono',monospace"}}>
              💡 KMU: Info-E-Mail wahrscheinlich direkt beim GF — persönliche Ansprache empfohlen
            </div>
          )}

          {/* Qual signals */}
          {isHot && (
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
              {lead.signals.slice(0,4).map((s,i)=>(
                <span key={i} style={{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.35)",
                  color:"#fca5a5",fontSize:10,fontFamily:"'IBM Plex Mono',monospace",
                  padding:"2px 7px",borderRadius:3,whiteSpace:"nowrap"}}>⚠ {s}</span>
              ))}
              {lead.signals.length>4 && <span style={{background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.25)",
                color:"#93c5fd",fontSize:10,fontFamily:"'IBM Plex Mono',monospace",
                padding:"2px 7px",borderRadius:3}}>+{lead.signals.length-4} weitere</span>}
            </div>
          )}

          {/* Action buttons */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
            <button onClick={()=>{setTab("hunter");setOpen(true);}}
              style={{display:"flex",alignItems:"center",gap:5,
                background:tab==="hunter"&&open?"rgba(251,146,60,0.18)":"rgba(255,255,255,0.04)",
                border:`1px solid ${tab==="hunter"&&open?"rgba(251,146,60,0.45)":"rgba(255,255,255,0.1)"}`,
                color:tab==="hunter"&&open?"#fb923c":"#6b7280",
                fontSize:11,fontFamily:"'IBM Plex Mono',monospace",padding:"4px 10px",borderRadius:5}}>
              📧 Hunter.io
              {lead.hunterEmails?.length>0 && <span style={{background:"#fb923c",color:"#000",borderRadius:3,
                fontSize:9,padding:"1px 5px",fontWeight:700}}>{lead.hunterEmails.length}</span>}
            </button>
            <a href={`https://www.google.com/maps/place/?q=place_id:${lead.placeId}`}
              target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
              style={{display:"flex",alignItems:"center",gap:5,
                background:"rgba(34,197,94,0.07)",border:"1px solid rgba(34,197,94,0.2)",
                color:"#86efac",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
                padding:"4px 10px",borderRadius:5,textDecoration:"none"}}>
              🗺 Maps
            </a>
          </div>
        </div>

        {/* Rating */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
          {lead.rating ? <StarRating rating={lead.rating}/> :
            <span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>–</span>}
          <span style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>{lead.reviewCount??0} Bew.</span>
          {lead.headcount && <span style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>👥 {lead.headcount}</span>}
          <span style={{fontSize:10,color:"#1f2937",marginTop:6}}>{open?"▲":"▼"}</span>
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(255,255,255,0.05)"}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
            {[{id:"reviews",label:"📋 Reviews"},{id:"hunter",label:"📧 Hunter.io"},{id:"apollo",label:"🔍 Apollo"},{id:"hr",label:"🏛 Handelsregister"}].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
                  background:tab===t.id?"rgba(255,255,255,0.07)":"transparent",
                  border:`1px solid ${tab===t.id?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.05)"}`,
                  color:tab===t.id?"#f9fafb":"#4b5563",padding:"5px 12px",borderRadius:5}}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Reviews */}
          {tab==="reviews" && (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <span style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",
                  background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.25)",
                  color:"#86efac",padding:"2px 8px",borderRadius:3}}>✓ ECHTZEIT · GOOGLE PLACES</span>
              </div>
              {lead.reviewExamples?.length>0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>ERREICHBARKEITS-SIGNALE</div>
                  {lead.reviewExamples.map((r,i)=>(
                    <div key={i} style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.14)",
                      borderRadius:5,padding:"9px 12px",marginBottom:5,
                      fontSize:12,color:"#fca5a5",lineHeight:1.55}}>„{r}"</div>
                  ))}
                </div>
              )}
              {lead.allReviews?.length>0 && (
                <div>
                  <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>
                    LETZTE {lead.allReviews.length} REVIEWS
                  </div>
                  {lead.allReviews.map((r,i)=>{
                    const txt=r?.text?.text||r?.originalText?.text||"";
                    const rc=STAR_COLORS[r.rating]||"#6b7280";
                    return (
                      <div key={i} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",
                        borderRadius:5,padding:"9px 12px",marginBottom:5}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,gap:8}}>
                          <span style={{fontSize:11,color:"#9ca3af"}}>{r.authorAttribution?.displayName||"Anonym"}</span>
                          <div style={{display:"flex",gap:2}}>{[1,2,3,4,5].map(s=>(
                            <svg key={s} width="10" height="10" viewBox="0 0 24 24" fill={s<=(r.rating||0)?rc:"#1f2937"}>
                              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                            </svg>))}
                          </div>
                        </div>
                        <div style={{fontSize:12,color:"#6b7280",lineHeight:1.5}}>
                          {txt.slice(0,220)}{txt.length>220?"…":""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {lead.reviewsLoaded && !lead.allReviews?.length && (
                <div style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>
                  {isHot ? "Signale aus Bewertungstext erkannt." : "Keine Erreichbarkeits-Probleme gefunden."}
                </div>
              )}
            </div>
          )}

          {/* Hunter */}
          {tab==="hunter" && (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",
                  background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.25)",
                  color:"#fb923c",padding:"2px 8px",borderRadius:3}}>📧 HUNTER.IO · AUTO-RUN</span>
                {domain && <span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>{domain}</span>}
              </div>

              {lead.hunterLoading && (
                <div style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",animation:"pulse 1s infinite"}}>
                  ↻ Hunter.io durchsucht {domain}…
                </div>
              )}
              {lead.hunterError && (
                <div style={{padding:"8px 10px",background:"rgba(239,68,68,0.07)",border:"1px solid rgba(239,68,68,0.2)",
                  borderRadius:5,fontSize:11,color:"#fca5a5",fontFamily:"'IBM Plex Mono',monospace"}}>
                  ✗ {lead.hunterError}
                </div>
              )}

              {lead.hunterPattern && (
                <div style={{marginBottom:10,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.25)",
                    color:"#93c5fd",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
                    padding:"3px 10px",borderRadius:3}}>
                    Muster: {lead.hunterPattern}@{domain}
                  </span>
                  {lead.hunterOrg && <span style={{fontSize:11,color:"#6b7280"}}>{lead.hunterOrg}</span>}
                </div>
              )}

              {gfEmail && (
                <div style={{marginBottom:10,padding:"10px 12px",
                  background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:6}}>
                  <div style={{fontSize:10,color:"#86efac",fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>
                    ✓ ABGELEITETE GF-E-MAIL
                  </div>
                  <a href={`mailto:${gfEmail}`} style={{fontSize:13,color:"#4ade80",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>
                    {gfEmail}
                  </a>
                </div>
              )}

              {lead.hunterEmails?.length>0 ? (
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>
                    GEFUNDENE E-MAIL-ADRESSEN
                  </div>
                  {lead.hunterEmails.map((e,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
                      background:"rgba(255,255,255,0.025)",border:`1px solid ${(e.confidence||0)>=85?"rgba(34,197,94,0.2)":"rgba(255,255,255,0.06)"}`,
                      borderRadius:5,padding:"7px 10px"}}>
                      <div style={{flex:1}}>
                        {e.first_name && (
                          <div style={{fontSize:11,color:"#9ca3af",marginBottom:2}}>
                            {e.first_name} {e.last_name}
                            {e.position && <span style={{color:"#4b5563"}}> · {e.position}</span>}
                          </div>
                        )}
                        <a href={`mailto:${e.value}`}
                          style={{fontSize:12,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>
                          {e.value}
                        </a>
                      </div>
                      <ConfidencePill score={e.confidence||0}/>
                      {(e.confidence||0)<85 && (
                        <span style={{fontSize:9,color:"#f97316",fontFamily:"'IBM Plex Mono',monospace"}}>
                          MANUELL PRÜFEN
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (!lead.hunterLoading && !lead.hunterError && (
                <div style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>
                  {domain ? "Keine E-Mail-Adressen für diese Domain gefunden." : "Keine Website bekannt — Hunter benötigt eine Domain."}
                </div>
              ))}
            </div>
          )}

          {/* Apollo */}
          {tab==="apollo" && (
            <div>
              <div style={{marginBottom:10}}>
                <span style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",
                  background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.25)",
                  color:"#a78bfa",padding:"2px 8px",borderRadius:3}}>🔍 APOLLO.IO DEEP-LINKS</span>
              </div>
              <ApolloButton lead={lead}/>
              <div style={{marginTop:12,fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.6}}>
                ⓘ Öffnet Apollo mit vorausgefüllten Filtern. Kostenloser Apollo-Account ausreichend.
                Fehlt ein Ergebnis, erscheint ein Hinweis vor dem Öffnen.
              </div>
            </div>
          )}

          {/* Handelsregister */}
          {tab==="hr" && (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",
                  background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.25)",
                  color:"#a5b4fc",padding:"2px 8px",borderRadius:3}}>🏛 OFFENES HANDELSREGISTER</span>
              </div>
              {lead.hrLoading && (
                <div style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",animation:"pulse 1s infinite"}}>
                  ↻ Handelsregister wird durchsucht…
                </div>
              )}
              {lead.geschaeftsfuehrer?.length>0 ? (
                <div>
                  <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>
                    GESCHÄFTSFÜHRUNG
                  </div>
                  {lead.geschaeftsfuehrer.map((gf,i)=>(
                    <div key={i} style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",
                      borderRadius:5,padding:"9px 12px",marginBottom:5}}>
                      <div style={{fontSize:13,fontWeight:600,color:"#f9fafb",marginBottom:3}}>{gf.name}</div>
                      <div style={{fontSize:11,color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>{gf.position}</div>
                      {lead.hunterPattern && domain && (
                        <div style={{marginTop:6}}>
                          <span style={{fontSize:11,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace"}}>
                            Abgeleitete E-Mail: {deriveGfEmail(gf.name,lead.hunterPattern,domain)||"konnte nicht abgeleitet werden"}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (!lead.hrLoading && (
                <div style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>
                  {lead.hrFound===false
                    ? "Kein Eintrag im Handelsregister gefunden — bei sehr kleinen Betrieben normal."
                    : "Handelsregister-Daten werden geladen…"}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  {id:"hot",     label:"🔥 Hot Leads",         color:"#ef4444"},
  {id:"second",  label:"⚡ Second Choice",      color:"#f97316"},
  {id:"small",   label:"👥 KMU Klein (1–20)",   color:"#3b82f6"},
  {id:"large",   label:"🏭 KMU Groß (21+)",     color:"#8b5cf6"},
];

export default function Home() {
  const [region,setRegion]     = useState("");
  const [custom,setCustom]     = useState("");
  const [leads,setLeads]       = useState([]);
  const [loading,setLoading]   = useState(false);
  const [phase,setPhase]       = useState("");
  const [progress,setProgress] = useState({done:0,total:0,subPhase:""});
  const [error,setError]       = useState("");
  const [activeTab,setActiveTab] = useState("hot");
  const [done,setDone]         = useState(false);
  const abortRef = useRef(false);
  const effectiveRegion = custom||region;

  // ── Main pipeline ────────────────────────────────────────────────────────────

  const runSearch = useCallback(async () => {
    if (!effectiveRegion) return;
    abortRef.current = false;
    setLoading(true); setLeads([]); setDone(false); setError("");
    setPhase("1/3 · Google Maps: Suche Containerdienste…");
    setProgress({done:0,total:0,subPhase:""});

    try {
      // ── Phase 1: Places search ──
      const places = await apiSearchPlaces(`Containerdienst Entsorgung ${effectiveRegion}`);
      if (!places.length) { setError("Keine Ergebnisse für diese Region."); setLoading(false); return; }

      let current = places.map(p=>{
        const rc = p.userRatingCount??0;
        const nm = (p.displayName?.text||"").toLowerCase();
        // Initial size classification from Places data (refined later with Hunter)
        let initSize = "small";
        if (LARGE_NAME_SIGNALS.some(s=>nm.includes(s))) initSize="large";
        else if (SMALL_NAME_SIGNALS.some(s=>nm.includes(s))) initSize="small";
        else if (rc > 30) initSize="large";
        const initReason = rc > 30 ? `Reviews: ${rc} → >30 = groß` : `Reviews: ${rc} → ≤30 = klein`;
        return {
          placeId:p.id,
          name:p.displayName?.text||"Unbekannt",
          address:p.formattedAddress||"",
          rating:p.rating??null,
          reviewCount:rc,
          website:p.websiteUri||null,
          phone:p.nationalPhoneNumber||null,
          signals:[],reviewExamples:[],allReviews:[],
          reviewsLoaded:false,
          hunterLoading:false,hunterEmails:null,hunterPattern:null,hunterOrg:null,
          hunterError:null,hunterDone:false,hunterAvgConf:0,
          hrLoading:false,geschaeftsfuehrer:[],hrFound:null,
          headcount:null,isKmu:initSize==="small",gfDerived:null,
          sizeClass:initSize,sizeReason:initReason,sizeOverride:null,
        };
      });
      setLeads([...current]);

      // ── Phase 2: Reviews ──
      setPhase("2/3 · Google Reviews: Analysiere Erreichbarkeits-Signale…");
      setProgress({done:0,total:current.length,subPhase:"Reviews"});

      for (let i=0;i<current.length;i++) {
        if (abortRef.current) break;
        try {
          const {reviews,rating,reviewCount} = await apiFetchReviews(current[i].placeId);
          const {signals,examples} = detectQualSignals(reviews);
          current[i]={...current[i],rating:rating??current[i].rating,
            reviewCount:reviewCount??current[i].reviewCount,
            signals,reviewExamples:examples,allReviews:reviews,reviewsLoaded:true};
          setLeads([...current]);
        } catch { current[i]={...current[i],reviewsLoaded:true}; }
        setProgress({done:i+1,total:current.length,subPhase:"Reviews"});
        if (i<current.length-1) await new Promise(r=>setTimeout(r,160));
      }

      // ── Phase 3: Hunter + Handelsregister (parallel per lead) ──
      setPhase("3/3 · Hunter.io & Handelsregister: E-Mails & Geschäftsführer…");
      setProgress({done:0,total:current.length,subPhase:"Hunter + HR"});

      for (let i=0;i<current.length;i++) {
        if (abortRef.current) break;
        const lead = current[i];
        const domain = extractDomain(lead.website||"");

        // Mark loading
        current[i]={...current[i],hunterLoading:!!domain,hrLoading:true};
        setLeads([...current]);

        // Run both in parallel
        const [hunterResult,hrResult] = await Promise.allSettled([
          domain ? apiHunter(domain) : Promise.resolve(null),
          apiHandelsregister(lead.name),
        ]);

        // Process Hunter
        let hunterEmails=null,hunterPattern=null,hunterOrg=null,hunterError=null,headcount=null;
        if (domain && hunterResult.status==="fulfilled" && hunterResult.value) {
          const h = hunterResult.value;
          hunterEmails = h.emails||[];
          hunterPattern = h.pattern||null;
          hunterOrg = h.organization||null;
          headcount = h.headcount||null;
        } else if (hunterResult.status==="rejected") {
          hunterError = hunterResult.reason?.message||"Hunter Fehler";
        }

        const hunterAvgConf = hunterEmails ? avgConfidence(hunterEmails) : 0;

        // ICP size classification — always produces a result, never empty
        const sizeClass = classifySize(current[i], headcount);
        const isKmu = sizeClass === "small";
        const sizeReason = headcount
          ? ("Hunter: "+headcount)
          : LARGE_NAME_SIGNALS.some(s=>(current[i].name||"").toLowerCase().includes(s))
            ? "Firmenname → groß"
            : SMALL_NAME_SIGNALS.some(s=>(current[i].name||"").toLowerCase().includes(s))
              ? "Firmenname → klein"
              : ("Reviews: "+(current[i].reviewCount||0)+" → "+(sizeClass==="small"?"≤30 = klein":">30 = groß"));

        // Derive GF email if possible
        let gfDerived = null;
        let gfList = [];

        // Process Handelsregister
        if (hrResult.status==="fulfilled" && hrResult.value?.found) {
          gfList = hrResult.value.geschaeftsfuehrer||[];
          if (gfList.length>0 && hunterPattern && domain) {
            gfDerived = deriveGfEmail(gfList[0].name,hunterPattern,domain);
          }
        }

        current[i]={...current[i],
          hunterLoading:false,hunterEmails,hunterPattern,hunterOrg,hunterError,
          hunterDone:true,hunterAvgConf,headcount,
          sizeClass,isKmu,sizeReason,sizeOverride:null,
          hrLoading:false,
          geschaeftsfuehrer:gfList,
          hrFound:hrResult.status==="fulfilled"?hrResult.value?.found:false,
          gfDerived,
        };
        setLeads([...current]);
        setProgress({done:i+1,total:current.length,subPhase:"Hunter + HR"});
        if (i<current.length-1) await new Promise(r=>setTimeout(r,200));
      }

      setDone(true);
    } catch(e) { setError(e.message||"Fehler – bitte Administrator kontaktieren."); }
    finally { setLoading(false); setPhase(""); }
  },[effectiveRegion]);

  // ── Tab classification ────────────────────────────────────────────────────

  const leadsWithPattern = leads.filter(l=>l.hunterPattern||l.hunterEmails?.length>0);

  const hotLeads = leadsWithPattern.filter(l=>l.signals?.length>0 && l.hunterAvgConf>=85);

  const secondLeads = leads.filter(l=>l.hunterDone && !l.hunterPattern && !(l.hunterEmails?.length>0))
    .concat(leadsWithPattern.filter(l=>l.hunterAvgConf>0 && l.hunterAvgConf<85));

  // ── ICP Tab Classification ────────────────────────────────────────────────
  // KMU-Tabs zeigen ALLE verarbeiteten Leads (nicht nur die mit Hunter-Muster)
  // damit kein Lead verloren geht. sizeClass wurde im Pipeline mit classifySize() gesetzt.
  // sizeOverride = null → automatisch, "small"/"large" → manuell überschrieben.

  // Show all leads with reviews — sizeClass is always set (from Places immediately)
  const processedLeads = leads.filter(l=>l.reviewsLoaded||l.hunterDone);

  const effectiveSize = (l) => l.sizeOverride || l.sizeClass || "small";

  const smallLeads = processedLeads.filter(l=>effectiveSize(l)==="small");
  const largeLeads = processedLeads.filter(l=>effectiveSize(l)==="large");

  const tabLeads = {hot:hotLeads, second:secondLeads, small:smallLeads, large:largeLeads};
  const tabCounts= {hot:hotLeads.length, second:secondLeads.length, small:smallLeads.length, large:largeLeads.length};

  // Manual size override — updates lead in state
  const toggleSize = (placeId) => {
    setLeads(prev=>prev.map(l=>{
      if (l.placeId!==placeId) return l;
      const cur = l.sizeOverride || l.sizeClass;
      return {...l, sizeOverride: cur==="small"?"large":"small"};
    }));
  };

  const currentLeads = tabLeads[activeTab]||[];

  // ── Google Sheets / CSV Export ────────────────────────────────────────────

  const exportSheets = () => {
    const h=["#","Firma","Adresse","Bewertung","Reviews","Geschäftsführer",
      "GF E-Mail (abgeleitet)","Website","Telefon","Hunter Muster","Ø Konfidenz",
      "Mitarbeiterzahl","Hot Lead","Signale","Review-Zitat","Kontakt mailto","Place ID"];
    const rows=currentLeads.map((l,i)=>{
      const gfName=(l.geschaeftsfuehrer||[]).map(g=>g.name).join("; ");
      const bestEmail=l.gfDerived||l.hunterEmails?.find(e=>(e.confidence||0)>=85)?.value||
        l.hunterEmails?.[0]?.value||"";
      const mailtoLink=bestEmail?`mailto:${bestEmail}`:"";
      return [
        i+1,`"${l.name}"`,`"${l.address}"`,l.rating??"",l.reviewCount??0,
        `"${gfName}"`,`"${l.gfDerived||""}"`,`"${l.website||""}"`,`"${l.phone||""}"`,
        `"${l.hunterPattern?`${l.hunterPattern}@${extractDomain(l.website||"")}`:""}"`,
        l.hunterAvgConf||"",`"${l.headcount||""}"`,
        l.signals?.length>0?"JA":"NEIN",
        `"${(l.signals||[]).join("; ")}"`,
        `"${(l.reviewExamples?.[0]||"").replace(/"/g,"'")}"`,
        `"${mailtoLink}"`,`"${l.placeId}"`,
      ];
    });
    const csv=[h,...rows].map(r=>r.join(",")).join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`waiste-${activeTab}-${effectiveRegion}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // ── Stats ────────────────────────────────────────────────────────────────

  const totalDone = leads.filter(l=>l.hunterDone).length;
  const totalWithPattern = leadsWithPattern.length;
  const avgRating = leads.filter(l=>l.rating).length
    ? (leads.filter(l=>l.rating).reduce((s,l)=>s+l.rating,0)/leads.filter(l=>l.rating).length).toFixed(1)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>wAIste Lead Finder v2</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>♻</text></svg>"/>
      </Head>

      <div style={{minHeight:"100vh",background:"#07090f"}}>

        {/* Header */}
        <div style={{background:"linear-gradient(180deg,#0d1117 0%,#07090f 100%)",
          borderBottom:"1px solid rgba(255,255,255,0.05)",
          padding:"18px 28px 16px",position:"sticky",top:0,zIndex:50}}>
          <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:36,height:36,borderRadius:8,
              background:"linear-gradient(135deg,#16a34a,#0f6b2e)",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>♻</div>
            <div>
              <div style={{fontSize:18,fontWeight:700,color:"#f9fafb",letterSpacing:"-0.02em"}}>
                wAIste <span style={{color:"#16a34a"}}>Lead Finder</span>
                <span style={{marginLeft:8,fontSize:9,fontFamily:"'IBM Plex Mono',monospace",
                  background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",
                  color:"#86efac",padding:"2px 7px",borderRadius:3,verticalAlign:"middle"}}>v2 · LIVE</span>
              </div>
              <div style={{fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.06em",marginTop:1}}>
                GOOGLE PLACES · HUNTER.IO AUTO-RUN · HANDELSREGISTER · APOLLO.IO · ICP SEGMENTIERUNG
              </div>
            </div>
          </div>
        </div>

        <div style={{maxWidth:960,margin:"0 auto",padding:"22px 28px 48px"}}>

          {/* Search */}
          <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:10,padding:"18px 20px",marginBottom:20}}>
            <div style={{fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",
              marginBottom:12,letterSpacing:"0.08em"}}>REGION AUSWÄHLEN</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <select value={region} onChange={e=>{setRegion(e.target.value);setCustom("");}}
                style={{flex:1,minWidth:160,background:"#0a0f17",
                  border:"1px solid rgba(255,255,255,0.09)",color:region?"#f9fafb":"#374151",
                  borderRadius:6,padding:"9px 12px",fontSize:13}}>
                <option value="">Stadt wählen…</option>
                {REGIONS.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
              <input type="text" placeholder="oder eigene Eingabe (Landkreis Emsland…)"
                value={custom} onChange={e=>{setCustom(e.target.value);setRegion("");}}
                style={{flex:2,minWidth:200,background:"#0a0f17",border:"1px solid rgba(255,255,255,0.09)",
                  color:"#f9fafb",borderRadius:6,padding:"9px 12px",fontSize:13}}/>
              <button onClick={runSearch} disabled={loading||!effectiveRegion}
                style={{background:loading?"#14532d":!effectiveRegion?"#141a12":"#15803d",
                  color:"#fff",border:"none",borderRadius:6,padding:"9px 20px",fontSize:13,
                  fontWeight:600,whiteSpace:"nowrap",opacity:!effectiveRegion?0.4:1}}>
                {loading?<span style={{animation:"pulse 1s infinite"}}>⟳ Suche…</span>:"🔍 Leads suchen"}
              </button>
              {loading && <button onClick={()=>{abortRef.current=true;}}
                style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.25)",
                  color:"#fca5a5",borderRadius:6,padding:"9px 14px",fontSize:12,
                  fontFamily:"'IBM Plex Mono',monospace"}}>✕ Stop</button>}
            </div>

            {/* Progress */}
            {loading && (
              <div style={{marginTop:14}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>{phase}</span>
                  {progress.total>0 && <span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>{progress.done}/{progress.total}</span>}
                </div>
                <div style={{height:3,background:"#111827",borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:2,
                    background:"linear-gradient(90deg,#15803d,#22c55e)",
                    width:progress.total>0?`${(progress.done/progress.total)*100}%`:"30%",
                    transition:"width .3s ease",
                    animation:progress.total===0?"shimmer 1.5s infinite":"none",
                    backgroundSize:"600px 100%"}}/>
                </div>
                <div style={{marginTop:6,fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>
                  {phase.includes("3/3") && "⚡ Hunter.io & Handelsregister laufen gleichzeitig pro Firma — Hunter-Credits werden verbraucht"}
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && <div style={{background:"rgba(239,68,68,0.07)",border:"1px solid rgba(239,68,68,0.2)",
            borderRadius:8,padding:"12px 16px",color:"#fca5a5",fontFamily:"'IBM Plex Mono',monospace",
            fontSize:12,marginBottom:18}}>✗ {error}</div>}

          {/* Skeleton */}
          {loading && leads.length===0 && (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[...Array(6)].map((_,i)=>(
                <div key={i} style={{height:88,borderRadius:8,
                  background:"linear-gradient(90deg,rgba(255,255,255,0.02) 25%,rgba(255,255,255,0.05) 50%,rgba(255,255,255,0.02) 75%)",
                  backgroundSize:"600px 100%",animation:`shimmer 1.4s ${i*0.07}s infinite linear`}}/>
              ))}
            </div>
          )}

          {/* Stats */}
          {leads.length>0 && (
            <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18}}>
              {[
                {label:"Gesamt",          val:leads.length,                col:"#f9fafb"},
                {label:"Mit E-Mail Muster",val:totalWithPattern,           col:"#fb923c"},
                {label:"Hot Leads 🔥",    val:hotLeads.length,             col:"#ef4444"},
                {label:"Ø Bewertung",     val:avgRating?`${avgRating} ★`:"–", col:avgRating?STAR_COLORS[Math.round(parseFloat(avgRating))]:"#6b7280"},
                {label:"Verarbeitet",     val:`${totalDone}/${leads.length}`, col:"#4ade80"},
              ].map(s=>(
                <div key={s.label} style={{background:"rgba(255,255,255,0.025)",
                  border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,
                  padding:"10px 16px",flex:"1 1 120px"}}>
                  <div style={{fontSize:9,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",
                    marginBottom:4,letterSpacing:"0.07em"}}>{s.label.toUpperCase()}</div>
                  <div style={{fontSize:18,fontWeight:700,color:s.col,fontFamily:"'IBM Plex Mono',monospace"}}>{s.val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tab Navigation */}
          {done && (
            <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
              {TABS.map(t=>(
                <button key={t.id} onClick={()=>setActiveTab(t.id)}
                  style={{fontSize:12,fontFamily:"'IBM Plex Mono',monospace",
                    background:activeTab===t.id?`${t.color}20`:"rgba(255,255,255,0.03)",
                    border:`1px solid ${activeTab===t.id?t.color:"rgba(255,255,255,0.07)"}`,
                    color:activeTab===t.id?t.color:"#4b5563",
                    padding:"6px 14px",borderRadius:6,
                    display:"flex",alignItems:"center",gap:6}}>
                  {t.label}
                  <span style={{background:activeTab===t.id?t.color:"rgba(255,255,255,0.1)",
                    color:activeTab===t.id?"#000":"#6b7280",
                    fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:3}}>
                    {tabCounts[t.id]}
                  </span>
                </button>
              ))}

              {/* Export */}
              <button onClick={exportSheets}
                style={{marginLeft:"auto",background:"rgba(22,163,74,0.08)",
                  border:"1px solid rgba(22,163,74,0.25)",color:"#4ade80",
                  fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
                  padding:"6px 14px",borderRadius:6,display:"flex",alignItems:"center",gap:5}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                Google Sheets Export
              </button>
            </div>
          )}

          {/* Tab description */}
          {done && activeTab==="second" && (
            <div style={{marginBottom:12,padding:"10px 14px",
              background:"rgba(249,115,22,0.06)",border:"1px solid rgba(249,115,22,0.2)",
              borderRadius:8,fontSize:11,color:"#fb923c",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.6}}>
              ⚡ Second Choice: Firmen ohne Email-Muster oder Konfidenz &lt;85% — manuelle Entscheidung empfohlen. Bei KMU: Info-E-Mail direkt an GF adressieren.
            </div>
          )}
          {done && activeTab==="small" && (
            <div style={{marginBottom:12,padding:"10px 14px",
              background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.2)",
              borderRadius:8,fontSize:11,color:"#93c5fd",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.6}}>
              👥 <strong>KMU Klein (1–20 MA)</strong> · Klassifizierung: Hunter Headcount → Rechtsform → ≤30 Google Reviews.
              Badge an jeder Karte anklicken um Größe manuell zu korrigieren (✏ = manuell überschrieben).
              Info-E-Mail landet bei kleinen Betrieben oft direkt beim GF.
            </div>
          )}
          {done && activeTab==="large" && (
            <div style={{marginBottom:12,padding:"10px 14px",
              background:"rgba(139,92,246,0.06)",border:"1px solid rgba(139,92,246,0.2)",
              borderRadius:8,fontSize:11,color:"#a78bfa",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.6}}>
              🏭 <strong>KMU Groß (21+ MA)</strong> · Klassifizierung: Hunter Headcount → Rechtsform → >30 Google Reviews.
              Badge an jeder Karte anklicken um Größe manuell zu korrigieren (✏ = manuell überschrieben).
              Direkter GF-Kontakt via Handelsregister + Hunter-Muster empfohlen.
            </div>
          )}

          {/* Lead Cards */}
          {currentLeads.length>0 && (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {currentLeads.map((lead,i)=>(
                <div key={lead.placeId||i} className="lead-in" style={{animationDelay:`${i*0.04}s`}}>
                  <LeadCard lead={lead} rank={i+1} toggleSize={toggleSize}/>
                </div>
              ))}
            </div>
          )}

          {/* Empty tab state */}
          {done && currentLeads.length===0 && (
            <div style={{textAlign:"center",padding:"48px 20px",color:"#1f2937"}}>
              <div style={{fontSize:36,marginBottom:10}}>
                {activeTab==="hot"?"🔥":activeTab==="second"?"⚡":activeTab==="small"?"👥":"🏭"}
              </div>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,marginBottom:6}}>
                {activeTab==="hot" && "Keine Hot Leads gefunden — alle Firmen in Second Choice oder ohne Review-Signale."}
                {activeTab==="second" && "Keine Second-Choice-Leads — alle Firmen haben gute Email-Konfidenz."}
                {activeTab==="small" && "Keine KMU mit bekanntem Headcount (1–20 MA) gefunden."}
                {activeTab==="large" && "Keine größeren KMU (21+ MA) mit Headcount-Daten gefunden."}
              </div>
            </div>
          )}

          {/* Initial state */}
          {!loading && !done && !error && (
            <div style={{textAlign:"center",padding:"64px 20px"}}>
              <div style={{fontSize:52,marginBottom:14,opacity:.12}}>♻</div>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:"#1f2937",marginBottom:6}}>
                Region wählen → Automatische Lead-Analyse starten
              </div>
              <div style={{fontSize:10,color:"#111827",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.8}}>
                Google Places → Reviews → Hunter.io Auto-Run → Handelsregister → ICP Segmentierung
              </div>
            </div>
          )}

          {/* Footer */}
          {done && (
            <div style={{marginTop:22,padding:"12px 16px",
              background:"rgba(255,255,255,0.015)",border:"1px solid rgba(255,255,255,0.04)",
              borderRadius:8,fontSize:10,color:"#1f2937",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.7}}>
              ✓ Nur Firmen mit Hunter.io E-Mail-Muster in Haupt-Tabs · Second Choice = &lt;85% Konfidenz ·
              GF via Handelsregister (offeneregister.de) · Google Sheets Export mit mailto:-Links
            </div>
          )}
        </div>
      </div>
    </>
  );
}
