import { useState, useCallback, useRef } from "react";
import Head from "next/head";

const REGIONS = [
  "Berlin","Hamburg","München","Köln","Frankfurt am Main","Stuttgart","Düsseldorf",
  "Dortmund","Essen","Leipzig","Bremen","Dresden","Hannover","Nürnberg","Duisburg",
  "Bochum","Wuppertal","Bielefeld","Bonn","Münster","Karlsruhe","Mannheim","Augsburg",
  "Wiesbaden","Gelsenkirchen","Mönchengladbach","Braunschweig","Kiel","Chemnitz","Aachen",
  "Halle (Saale)","Magdeburg","Freiburg im Breisgau","Krefeld","Lübeck","Oberhausen",
  "Erfurt","Mainz","Rostock","Kassel",
];

const QUAL_KEYWORDS = [
  "kein rückruf","nicht erreichbar","telefon besetzt","niemand abgehoben",
  "keiner meldet sich","keine antwort","schlechte erreichbarkeit","anrufbeantworter",
  "nicht zurückgerufen","niemand geht ran","nicht ans telefon","warteschleife",
  "kein ansprechpartner","meldet sich nicht","geht nicht ran","mehrmals angerufen",
  "nochmal angerufen","kommt nie","nicht gemeldet",
];

const STAR_COLORS = { 1:"#ef4444",2:"#f97316",3:"#eab308",4:"#84cc16",5:"#22c55e" };
const MIN_CONF = 85;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function domain(url="") {
  try { return new URL(url.startsWith("http")?url:`https://${url}`).hostname.replace(/^www\./,""); }
  catch { return null; }
}

function deriveEmail(fullName, pattern, dom) {
  if (!fullName||!pattern||!dom) return null;
  const fix = s => s.replace(/[äöüß]/g,c=>({ä:"ae",ö:"oe",ü:"ue",ß:"ss"}[c]||c)).replace(/[^a-z0-9.-]/gi,"");
  const parts = fullName.toLowerCase().trim().split(/\s+/);
  if (parts.length < 2) return null;
  const f = fix(parts[0]), l = fix(parts[parts.length-1]);
  const addr = pattern.replace("{first}",f).replace("{last}",l).replace("{f}",f[0]||"").replace("{l}",l[0]||"");
  return `${addr}@${dom}`;
}

function qualSignals(reviews=[]) {
  const sig=new Set(), ex=[];
  for (const r of reviews) {
    const t=(r?.text?.text||r?.originalText?.text||"").toLowerCase();
    for (const kw of QUAL_KEYWORDS) {
      if (t.includes(kw)) {
        sig.add(kw[0].toUpperCase()+kw.slice(1));
        const full=r?.text?.text||r?.originalText?.text||"";
        if (ex.length<3&&!ex.includes(full)) ex.push(full.length>180?full.slice(0,180)+"…":full);
      }
    }
  }
  return {signals:[...sig],examples:ex};
}

// ─── API ──────────────────────────────────────────────────────────────────────

const api = {
  search: async q => {
    const r = await fetch("/api/places-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q})});
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||`Fehler ${r.status}`);
    return (await r.json()).places||[];
  },
  reviews: async id => { const r=await fetch(`/api/places-detail?placeId=${encodeURIComponent(id)}`); return r.ok?r.json():{reviews:[]}; },
  hunter:  async d  => { const r=await fetch(`/api/hunter?domain=${encodeURIComponent(d)}`); return r.ok?r.json():{}; },
  hr:      async n  => { const r=await fetch(`/api/handelsregister?name=${encodeURIComponent(n)}`); return r.ok?r.json():{officers:[]}; },
};

// ─── Components ───────────────────────────────────────────────────────────────

function Stars({rating}) {
  const c=STAR_COLORS[Math.round(rating)]||"#6b7280";
  return <div style={{display:"flex",alignItems:"center",gap:4}}>
    {[1,2,3,4,5].map(s=><svg key={s} width="13" height="13" viewBox="0 0 24 24" fill={s<=Math.round(rating)?c:"#1f2937"}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>)}
    <span style={{color:c,fontSize:13,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{rating?.toFixed(1)??"–"}</span>
  </div>;
}

function ApolloErrorModal({onClose}) {
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
    <div style={{background:"#0d1117",border:"1px solid rgba(239,68,68,0.35)",borderRadius:12,padding:"28px 32px",maxWidth:420,width:"100%"}} onClick={e=>e.stopPropagation()}>
      <div style={{fontSize:28,marginBottom:12}}>🔍</div>
      <div style={{fontSize:15,fontWeight:700,color:"#f9fafb",marginBottom:8}}>Apollo liefert keine Ergebnisse</div>
      <div style={{fontSize:13,color:"#6b7280",lineHeight:1.7,marginBottom:20}}>
        Für diese Firma wurden keine Entscheider in Apollo gefunden.<br/>
        <strong style={{color:"#9ca3af"}}>Empfehlung:</strong> Nutze das Hunter E-Mail-Muster und schreibe den Geschäftsführer direkt über die abgeleitete Adresse an.
      </div>
      <button onClick={onClose} style={{background:"#15803d",color:"#fff",border:"none",borderRadius:6,padding:"9px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Verstanden</button>
    </div>
  </div>;
}

function LeadCard({lead,rank}) {
  const [open,setOpen]=useState(false);
  const [tab,setTab]=useState("overview");
  const [apolloErr,setApolloErr]=useState(false);
  const isHot=lead.signals?.length>0;
  const dom=domain(lead.website||"");
  const qualEmails=(lead.hunterEmails||[]).filter(e=>(e.confidence||0)>=MIN_CONF);
  const isKMU=(lead.reviewCount||0)<200;
  const gfEmail=lead.officers?.[0]&&lead.hunterPattern&&dom?deriveEmail(lead.officers[0].name,lead.hunterPattern,dom):null;
  const infoAddr=dom?`info@${dom}`:null;

  const handleApollo=e=>{
    e.stopPropagation();
    window.open(`https://app.apollo.io/#/people?${new URLSearchParams(dom?{"q_organization_domains[]":dom,"q_person_titles[]":"Geschäftsführer"}:{"q_organization_names[]":lead.name,"q_person_titles[]":"Geschäftsführer"})}`, "_blank","noopener");
    if (qualEmails.length===0&&!lead.hunterPattern) setTimeout(()=>setApolloErr(true),900);
  };

  const s=(bg,border,color,extra={})=>({background:bg,border:`1px solid ${border}`,color,fontSize:10,fontFamily:"'IBM Plex Mono',monospace",padding:"2px 7px",borderRadius:3,whiteSpace:"nowrap",...extra});

  return <>
    {apolloErr&&<ApolloErrorModal onClose={()=>setApolloErr(false)}/>}
    <div onClick={()=>setOpen(!open)} style={{background:isHot?"rgba(239,68,68,0.04)":"rgba(255,255,255,0.02)",border:`1px solid ${isHot?"rgba(239,68,68,0.22)":"rgba(255,255,255,0.07)"}`,borderRadius:8,padding:"14px 18px",cursor:"pointer",transition:"border-color .15s"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div style={{flex:1,minWidth:0}}>
          {/* Name row */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",minWidth:22}}>#{rank}</span>
            <span style={{fontSize:15,fontWeight:700,color:"#f9fafb",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:240}}>{lead.name}</span>
            {isHot&&<span style={s("rgba(239,68,68,0.18)","rgba(239,68,68,0.4)","#ef4444",{fontSize:9,letterSpacing:"0.06em"})}>🔥 HOT LEAD</span>}
            {lead.officers?.[0]&&<span style={s("rgba(59,130,246,0.12)","rgba(59,130,246,0.3)","#93c5fd",{fontSize:9})}>👤 {lead.officers[0].name}</span>}
            {isKMU&&<span style={s("rgba(168,85,247,0.12)","rgba(168,85,247,0.3)","#c4b5fd",{fontSize:9})}>KMU</span>}
          </div>
          {/* Meta */}
          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:6}}>
            {lead.address&&<span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>📍 {lead.address}</span>}
            {lead.website&&<a href={lead.website} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:11,color:"#3b82f6",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>🔗 {dom}</a>}
            {lead.phone&&<a href={`tel:${lead.phone}`} onClick={e=>e.stopPropagation()} style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>📞 {lead.phone}</a>}
          </div>
          {/* Pattern + derived email */}
          {lead.hunterPattern&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            <span style={s("rgba(251,146,60,0.1)","rgba(251,146,60,0.25)","#fb923c")}>📧 {lead.hunterPattern}@{dom}</span>
            {gfEmail&&<span style={s("rgba(34,197,94,0.1)","rgba(34,197,94,0.25)","#86efac")}>✉ GF: {gfEmail}</span>}
          </div>}
          {/* Qual signals */}
          {isHot&&<div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
            {lead.signals.slice(0,4).map((sg,i)=><span key={i} style={s("rgba(239,68,68,0.12)","rgba(239,68,68,0.35)","#fca5a5")}>⚠ {sg}</span>)}
          </div>}
          {/* Buttons */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
            <button onClick={handleApollo} style={{...s("rgba(139,92,246,0.08)","rgba(139,92,246,0.25)","#a78bfa"),padding:"4px 10px",cursor:"pointer"}}>🔍 Apollo →</button>
            <a href={`https://www.google.com/maps/place/?q=place_id:${lead.placeId}`} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{...s("rgba(34,197,94,0.07)","rgba(34,197,94,0.2)","#86efac"),padding:"4px 10px",textDecoration:"none"}}>🗺 Maps</a>
            {lead.officers?.length>0&&<a href="https://www.handelsregister.de/rp_web/ergebnisse.xhtml" target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{...s("rgba(59,130,246,0.07)","rgba(59,130,246,0.2)","#93c5fd"),padding:"4px 10px",textDecoration:"none"}}>🏛 HR</a>}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
          {lead.rating?<Stars rating={lead.rating}/>:<span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>–</span>}
          <span style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>{lead.reviewCount??0} Bew.</span>
          <span style={{fontSize:10,color:"#1f2937",marginTop:6}}>{open?"▲":"▼"}</span>
        </div>
      </div>

      {open&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(255,255,255,0.05)"}} onClick={e=>e.stopPropagation()}>
        {/* Tab bar */}
        <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
          {[{id:"overview",l:"📋 Übersicht"},{id:"reviews",l:"⭐ Reviews"},{id:"emails",l:`📧 E-Mails (${qualEmails.length})`},{id:"gf",l:`👤 GF (${lead.officers?.length||0})`}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{fontSize:11,fontFamily:"'IBM Plex Mono',monospace",background:tab===t.id?"rgba(255,255,255,0.07)":"transparent",border:`1px solid ${tab===t.id?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.05)"}`,color:tab===t.id?"#f9fafb":"#4b5563",padding:"5px 12px",borderRadius:5,cursor:"pointer"}}>{t.l}</button>
          ))}
        </div>

        {/* OVERVIEW */}
        {tab==="overview"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div style={{background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.15)",borderRadius:7,padding:"12px 14px"}}>
            <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginBottom:8}}>GESCHÄFTSFÜHRUNG · HANDELSREGISTER</div>
            {lead.officers?.length>0?lead.officers.map((o,i)=><div key={i} style={{marginBottom:6}}>
              <div style={{fontSize:13,fontWeight:600,color:"#f9fafb"}}>{o.name}</div>
              <div style={{fontSize:11,color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>{o.position}</div>
            </div>):<div style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>Nicht gefunden</div>}
          </div>
          <div style={{background:"rgba(251,146,60,0.06)",border:"1px solid rgba(251,146,60,0.15)",borderRadius:7,padding:"12px 14px"}}>
            <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginBottom:8}}>OUTREACH STRATEGIE</div>
            {gfEmail?<div>
              <div style={{fontSize:10,color:"#86efac",fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>✓ GF-E-Mail abgeleitet</div>
              <a href={`mailto:${gfEmail}`} style={{fontSize:12,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>{gfEmail}</a>
            </div>:isKMU&&infoAddr?<div>
              <div style={{fontSize:10,color:"#c4b5fd",fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>💡 KMU: Info-Adresse empfohlen</div>
              <a href={`mailto:${infoAddr}`} style={{fontSize:12,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none",display:"block",marginBottom:4}}>{infoAddr}</a>
              <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.5}}>{lead.officers?.[0]?.name?`Betreff: Attn. ${lead.officers[0].name}`:"GF namentlich im Betreff"}</div>
            </div>:<div style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>Kein Muster gefunden</div>}
          </div>
          <div style={{gridColumn:"1 / -1",display:"flex",flexDirection:"column",gap:7}}>
            {[{href:`https://app.apollo.io/#/organizations?${dom?`q_organization_domains[]=${encodeURIComponent(dom)}`:`q_organization_names[]=${encodeURIComponent(lead.name)}`}`,i:"🏢",l:"Firma in Apollo",sub:dom||lead.name},
              {href:`https://app.apollo.io/#/people?${new URLSearchParams(dom?{"q_organization_domains[]":dom,"q_person_titles[]":"Geschäftsführer"}:{"q_organization_names[]":lead.name,"q_person_titles[]":"Geschäftsführer"})}`,i:"👤",l:"GF in Apollo finden",sub:`Geschäftsführer · ${dom||lead.name}`}
            ].map((lk,i)=><a key={i} href={lk.href} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:10,background:"rgba(139,92,246,0.07)",border:"1px solid rgba(139,92,246,0.2)",borderRadius:7,padding:"10px 14px",textDecoration:"none"}}>
              <div style={{fontSize:16}}>{lk.i}</div>
              <div><div style={{fontSize:12,fontWeight:600,color:"#c4b5fd",marginBottom:2}}>{lk.l}</div><div style={{fontSize:10,color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>{lk.sub}</div></div>
              <span style={{marginLeft:"auto",color:"#6b7280"}}>→</span>
            </a>)}
          </div>
        </div>}

        {/* REVIEWS */}
        {tab==="reviews"&&<div>
          <span style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.25)",color:"#86efac",padding:"2px 8px",borderRadius:3,display:"inline-block",marginBottom:10}}>✓ ECHTZEIT · GOOGLE PLACES</span>
          {lead.reviewExamples?.length>0&&<div style={{marginBottom:10}}>
            <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>ERREICHBARKEITS-SIGNALE</div>
            {lead.reviewExamples.map((r,i)=><div key={i} style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.14)",borderRadius:5,padding:"9px 12px",marginBottom:5,fontSize:12,color:"#fca5a5",lineHeight:1.55}}>„{r}"</div>)}
          </div>}
          {lead.allReviews?.length>0&&<div>
            <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>LETZTE {lead.allReviews.length} REVIEWS</div>
            {lead.allReviews.map((r,i)=>{const t=r?.text?.text||r?.originalText?.text||"";const rc=STAR_COLORS[r.rating]||"#6b7280";return <div key={i} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:5,padding:"9px 12px",marginBottom:5}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:11,color:"#9ca3af"}}>{r.authorAttribution?.displayName||"Anonym"}</span><div style={{display:"flex",gap:2}}>{[1,2,3,4,5].map(s=><svg key={s} width="10" height="10" viewBox="0 0 24 24" fill={s<=(r.rating||0)?rc:"#1f2937"}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>)}</div></div>
              <div style={{fontSize:12,color:"#6b7280",lineHeight:1.5}}>{t.slice(0,220)}{t.length>220?"…":""}</div>
            </div>;})}
          </div>}
          {!lead.allReviews?.length&&<div style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>Keine öffentlichen Reviews verfügbar.</div>}
        </div>}

        {/* EMAILS */}
        {tab==="emails"&&<div>
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.25)",color:"#fb923c",padding:"2px 8px",borderRadius:3}}>📧 HUNTER.IO · ≥{MIN_CONF}% CONFIDENCE</span>
            {lead.hunterPattern&&<span style={{fontSize:10,color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>Muster: {lead.hunterPattern}@{dom}</span>}
          </div>
          {gfEmail&&<div style={{background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:7,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:10,color:"#86efac",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>✦ ABGELEITETE GF-E-MAIL</div>
            {lead.officers?.[0]&&<div style={{fontSize:11,color:"#9ca3af",marginBottom:4}}>{lead.officers[0].name} · {lead.officers[0].position}</div>}
            <a href={`mailto:${gfEmail}`} style={{fontSize:13,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>{gfEmail}</a>
            <div style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginTop:4}}>Aus Muster + Handelsregister abgeleitet</div>
          </div>}
          {qualEmails.length>0?<div style={{display:"flex",flexDirection:"column",gap:5}}>
            {qualEmails.map((e,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:5,padding:"8px 12px"}}>
              <div style={{flex:1}}>
                {e.first_name&&<div style={{fontSize:11,color:"#9ca3af",marginBottom:2}}>{e.first_name} {e.last_name}{e.position?` · ${e.position}`:""}</div>}
                <a href={`mailto:${e.value}`} style={{fontSize:12,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>{e.value}</a>
              </div>
              <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:(e.confidence||0)>=85?"#22c55e":"#eab308",display:"inline-block"}}/>
                <span style={{fontSize:10,color:(e.confidence||0)>=85?"#22c55e":"#eab308",fontFamily:"'IBM Plex Mono',monospace"}}>{e.confidence}%</span>
              </span>
            </div>)}
          </div>:<div>
            <div style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",marginBottom:10}}>Keine verifizierten E-Mails ≥{MIN_CONF}% gefunden.</div>
            {isKMU&&infoAddr&&<div style={{background:"rgba(168,85,247,0.07)",border:"1px solid rgba(168,85,247,0.2)",borderRadius:7,padding:"12px 14px"}}>
              <div style={{fontSize:10,color:"#c4b5fd",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>💡 KMU-STRATEGIE</div>
              <a href={`mailto:${infoAddr}`} style={{fontSize:13,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none",display:"block",marginBottom:6}}>{infoAddr}</a>
              <div style={{fontSize:11,color:"#6b7280",lineHeight:1.6}}>Bei kleinen Betrieben landet Info@ oft direkt beim Inhaber.{lead.officers?.[0]?.name?` Betreff: Attn. ${lead.officers[0].name}`:""}</div>
            </div>}
          </div>}
        </div>}

        {/* GF TAB */}
        {tab==="gf"&&<div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <span style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.25)",color:"#93c5fd",padding:"2px 8px",borderRadius:3}}>🏛 HANDELSREGISTER · OFFENEREGISTER.DE</span>
          </div>
          {lead.officers?.length>0?<div style={{display:"flex",flexDirection:"column",gap:8}}>
            {lead.officers.map((o,i)=>{const de=lead.hunterPattern&&dom?deriveEmail(o.name,lead.hunterPattern,dom):null;return<div key={i} style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:7,padding:"12px 14px"}}>
              <div style={{fontSize:14,fontWeight:600,color:"#f9fafb",marginBottom:3}}>{o.name}</div>
              <div style={{fontSize:11,color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",marginBottom:6}}>{o.position}</div>
              {de&&<div style={{display:"flex",alignItems:"center",gap:8}}>
                <a href={`mailto:${de}`} style={{fontSize:12,color:"#60a5fa",fontFamily:"'IBM Plex Mono',monospace",textDecoration:"none"}}>{de}</a>
                <span style={{fontSize:10,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>abgeleitet</span>
              </div>}
            </div>;})}
          </div>:<div style={{fontSize:11,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>
            Nicht im Handelsregister gefunden.<br/>
            <a href="https://www.handelsregister.de/rp_web/ergebnisse.xhtml" target="_blank" rel="noopener noreferrer" style={{color:"#3b82f6"}}>→ Manuell auf handelsregister.de suchen</a>
          </div>}
        </div>}
      </div>}
    </div>
  </>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [region,setRegion]=useState("");
  const [custom,setCustom]=useState("");
  const [leads,setLeads]=useState([]);
  const [loading,setLoading]=useState(false);
  const [progress,setProgress]=useState({done:0,total:0,phase:""});
  const [error,setError]=useState("");
  const [sortBy,setSortBy]=useState("hot_first");
  const [filterHot,setFilterHot]=useState(false);
  const [done,setDone]=useState(false);
  const abortRef=useRef(false);
  const eff=custom||region;

  const run=useCallback(async()=>{
    if(!eff) return;
    abortRef.current=false;
    setLoading(true);setLeads([]);setDone(false);setError("");
    setProgress({done:0,total:0,phase:"Suche Containerdienste…"});
    try {
      const places=await api.search(`Containerdienst Entsorgung ${eff}`);
      if(!places.length){setError("Keine Ergebnisse für diese Region.");setLoading(false);return;}
      const init=places.map(p=>({placeId:p.id,name:p.displayName?.text||"Unbekannt",address:p.formattedAddress||"",rating:p.rating??null,reviewCount:p.userRatingCount??0,website:p.websiteUri||null,phone:p.nationalPhoneNumber||null,signals:[],reviewExamples:[],allReviews:[],reviewsLoaded:false,hunterPattern:null,hunterEmails:[],hunterLoaded:false,officers:[],hrLoaded:false}));
      setProgress({done:0,total:init.length,phase:"Reviews · Hunter · Handelsregister…"});
      for(let i=0;i<init.length;i++){
        if(abortRef.current) break;
        const l=init[i];const dom=domain(l.website||"");
        try {
          const [rv,hu,hr]=await Promise.all([api.reviews(l.placeId),dom?api.hunter(dom):Promise.resolve({}),api.hr(l.name)]);
          const {signals,examples}=qualSignals(rv.reviews||[]);
          const goodEmails=(hu.emails||[]).filter(e=>(e.confidence||0)>=MIN_CONF);
          init[i]={...l,rating:rv.rating??l.rating,reviewCount:rv.reviewCount??l.reviewCount,signals,reviewExamples:examples,allReviews:rv.reviews||[],reviewsLoaded:true,hunterPattern:hu.pattern||null,hunterEmails:goodEmails,hunterLoaded:true,officers:hr.officers||[],hrLoaded:true};
        } catch {init[i]={...l,reviewsLoaded:true,hunterLoaded:true,hrLoaded:true};}
        setLeads([...init]);
        setProgress({done:i+1,total:init.length,phase:"Analysiere…"});
        if(i<init.length-1) await new Promise(r=>setTimeout(r,200));
      }
      setDone(true);
    } catch(e){setError(e.message||"Fehler.");}
    finally{setLoading(false);setProgress({done:0,total:0,phase:""});}
  },[eff]);

  // Only show firms with Hunter email pattern
  const filtered=leads.filter(l=>!l.hunterLoaded||!!l.hunterPattern);
  const sorted=[...filtered].filter(l=>!filterHot||l.signals?.length>0).sort((a,b)=>{
    if(sortBy==="hot_first"){const d=(b.signals?.length||0)-(a.signals?.length||0);return d||((a.rating??5)-(b.rating??5));}
    if(sortBy==="rating_asc") return(a.rating??5)-(b.rating??5);
    if(sortBy==="rating_desc") return(b.rating??0)-(a.rating??0);
    if(sortBy==="reviews_desc") return(b.reviewCount||0)-(a.reviewCount||0);
    return 0;
  });

  const hotCount=sorted.filter(l=>l.signals?.length>0).length;
  const rated=sorted.filter(l=>l.rating);
  const avg=rated.length?(rated.reduce((s,l)=>s+l.rating,0)/rated.length).toFixed(1):null;

  const exportCSV=()=>{
    const h=["#","Firma","Adresse","Bewertung","Reviews","Website","Telefon","Hot Lead","GF Name","GF Position","GF E-Mail","Hunter Muster","Verified Emails","Signale","Review-Zitat","Place ID"];
    const rows=sorted.map((l,i)=>{
      const dom=domain(l.website||"");
      const gfe=l.officers?.[0]&&l.hunterPattern&&dom?deriveEmail(l.officers[0].name,l.hunterPattern,dom):"";
      return[i+1,`"${l.name}"`,`"${l.address}"`,l.rating??"",l.reviewCount??0,`"${l.website||""}"`,`"${l.phone||""}"`,l.signals?.length>0?"JA":"NEIN",`"${l.officers?.[0]?.name||""}"`,`"${l.officers?.[0]?.position||""}"`,gfe?`=HYPERLINK("mailto:${gfe}","${gfe}")`:"",`"${l.hunterPattern?`${l.hunterPattern}@${dom}`:""}"`,`"${l.hunterEmails?.map(e=>e.value).join("; ")||""}"`,`"${(l.signals||[]).join("; ")}"`,`"${(l.reviewExamples?.[0]||"").replace(/"/g,"'")}"`,`"${l.placeId}"`];
    });
    const csv=[h,...rows].map(r=>r.join(",")).join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
    a.download=`waiste-leads-${eff}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return <>
    <Head><title>wAIste Lead Finder v2</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>
    <div style={{minHeight:"100vh",background:"#07090f",fontFamily:"'DM Sans',sans-serif"}}>

      {/* Header */}
      <div style={{background:"linear-gradient(180deg,#0d1117 0%,#07090f 100%)",borderBottom:"1px solid rgba(255,255,255,0.05)",padding:"20px 28px 18px",position:"sticky",top:0,zIndex:50}}>
        <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:38,height:38,borderRadius:9,background:"linear-gradient(135deg,#16a34a,#0f6b2e)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>♻</div>
          <div>
            <div style={{fontSize:19,fontWeight:700,color:"#f9fafb",letterSpacing:"-0.02em"}}>
              wAIste <span style={{color:"#16a34a"}}>Lead Finder</span>
              <span style={{marginLeft:10,fontSize:9,fontFamily:"'IBM Plex Mono',monospace",background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",color:"#86efac",padding:"2px 7px",borderRadius:3,verticalAlign:"middle"}}>v2 · LIVE</span>
            </div>
            <div style={{fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.06em",marginTop:2}}>
              GOOGLE PLACES · HUNTER AUTO · HANDELSREGISTER · APOLLO · NUR MIT EMAIL-MUSTER · ≥{MIN_CONF}%
            </div>
          </div>
        </div>
      </div>

      <div style={{maxWidth:960,margin:"0 auto",padding:"22px 28px 48px"}}>

        {/* Search */}
        <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"18px 20px",marginBottom:20}}>
          <div style={{fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",marginBottom:12,letterSpacing:"0.08em"}}>REGION AUSWÄHLEN</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <select value={region} onChange={e=>{setRegion(e.target.value);setCustom("");}} style={{flex:1,minWidth:160,background:"#0a0f17",border:"1px solid rgba(255,255,255,0.09)",color:region?"#f9fafb":"#374151",borderRadius:6,padding:"9px 12px",fontSize:13}}>
              <option value="">Stadt wählen…</option>
              {REGIONS.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
            <input type="text" placeholder="oder eigene Region (Landkreis Emsland…)" value={custom} onChange={e=>{setCustom(e.target.value);setRegion("");}} style={{flex:2,minWidth:200,background:"#0a0f17",border:"1px solid rgba(255,255,255,0.09)",color:"#f9fafb",borderRadius:6,padding:"9px 12px",fontSize:13}}/>
            <button onClick={run} disabled={loading||!eff} style={{background:loading?"#14532d":!eff?"#141a12":"#15803d",color:"#fff",border:"none",borderRadius:6,padding:"9px 20px",fontSize:13,fontWeight:600,cursor:loading||!eff?"not-allowed":"pointer",whiteSpace:"nowrap",opacity:!eff?0.4:1}}>
              {loading?<span style={{animation:"pulse 1s infinite"}}>⟳ Analysiere…</span>:"🔍 Leads suchen"}
            </button>
            {loading&&<button onClick={()=>{abortRef.current=true;}} style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.25)",color:"#fca5a5",borderRadius:6,padding:"9px 14px",fontSize:12,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer"}}>✕</button>}
          </div>
          <div style={{marginTop:10,fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.7}}>
            ⓘ Pipeline: Reviews + Hunter (auto) + Handelsregister (auto) parallel · Nur Firmen mit Email-Muster · Confidence ≥{MIN_CONF}% · GF-Email wird automatisch abgeleitet
          </div>
          {loading&&progress.total>0&&<div style={{marginTop:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>{progress.phase}</span>
              <span style={{fontSize:11,color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace"}}>{progress.done}/{progress.total}</span>
            </div>
            <div style={{height:3,background:"#111827",borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:2,background:"linear-gradient(90deg,#15803d,#22c55e)",width:`${(progress.done/progress.total)*100}%`,transition:"width .3s ease"}}/>
            </div>
          </div>}
        </div>

        {error&&<div style={{background:"rgba(239,68,68,0.07)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,padding:"12px 16px",color:"#fca5a5",fontFamily:"'IBM Plex Mono',monospace",fontSize:12,marginBottom:18}}>✗ {error}</div>}

        {loading&&leads.length===0&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[...Array(8)].map((_,i)=><div key={i} style={{height:88,borderRadius:8,background:"linear-gradient(90deg,rgba(255,255,255,0.02) 25%,rgba(255,255,255,0.05) 50%,rgba(255,255,255,0.02) 75%)",backgroundSize:"600px 100%",animation:`shimmer 1.4s ${i*0.07}s infinite linear`}}/>)}
        </div>}

        {/* Stats */}
        {sorted.length>0&&<div style={{marginBottom:16}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
            {[{l:"Mit Email-Muster",v:sorted.length,c:"#f9fafb"},{l:"Hot Leads 🔥",v:hotCount,c:"#ef4444"},{l:"Ø Bewertung",v:avg?`${avg} ★`:"–",c:avg?STAR_COLORS[Math.round(parseFloat(avg))]:"#6b7280"},{l:"GF gefunden",v:sorted.filter(l=>l.officers?.length>0).length,c:"#93c5fd"}].map(s=>(
              <div key={s.l} style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,padding:"11px 16px",flex:"1 1 130px"}}>
                <div style={{fontSize:9,color:"#374151",fontFamily:"'IBM Plex Mono',monospace",marginBottom:5,letterSpacing:"0.07em"}}>{s.l.toUpperCase()}</div>
                <div style={{fontSize:20,fontWeight:700,color:s.c,fontFamily:"'IBM Plex Mono',monospace"}}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:10,color:"#374151",fontFamily:"'IBM Plex Mono',monospace"}}>SORT:</span>
            {[{v:"hot_first",l:"🔥 Hot"},{v:"rating_asc",l:"↑ Schlechteste"},{v:"rating_desc",l:"↓ Beste"},{v:"reviews_desc",l:"★ Reviews"}].map(o=>(
              <button key={o.v} onClick={()=>setSortBy(o.v)} style={{background:sortBy===o.v?"rgba(59,130,246,0.15)":"rgba(255,255,255,0.03)",border:`1px solid ${sortBy===o.v?"#3b82f6":"rgba(255,255,255,0.07)"}`,color:sortBy===o.v?"#93c5fd":"#4b5563",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",padding:"5px 11px",borderRadius:5,cursor:"pointer"}}>{o.l}</button>
            ))}
            <button onClick={()=>setFilterHot(!filterHot)} style={{background:filterHot?"rgba(239,68,68,0.12)":"rgba(255,255,255,0.03)",border:`1px solid ${filterHot?"#ef4444":"rgba(255,255,255,0.07)"}`,color:filterHot?"#fca5a5":"#4b5563",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",padding:"5px 11px",borderRadius:5,cursor:"pointer",marginLeft:"auto"}}>⚠ Hot ({hotCount})</button>
            <button onClick={exportCSV} style={{background:"rgba(22,163,74,0.08)",border:"1px solid rgba(22,163,74,0.25)",color:"#4ade80",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",padding:"5px 13px",borderRadius:5,cursor:"pointer"}}>↓ CSV + Mailto</button>
          </div>
        </div>}

        {/* Cards */}
        {sorted.length>0&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
          {sorted.map((l,i)=><div key={l.placeId||i} style={{animation:"slideUp .22s ease both",animationDelay:`${i*0.04}s`}}><LeadCard lead={l} rank={i+1}/></div>)}
        </div>}

        {!loading&&done&&sorted.length===0&&<div style={{textAlign:"center",padding:"60px 20px",color:"#1f2937"}}>
          <div style={{fontSize:44,marginBottom:12}}>📭</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12}}>Keine Firmen mit Email-Muster in dieser Region.</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:"#111827",marginTop:6}}>Andere Region versuchen oder Hunter API Key prüfen.</div>
        </div>}

        {!loading&&!done&&!error&&<div style={{textAlign:"center",padding:"64px 20px"}}>
          <div style={{fontSize:52,marginBottom:14,opacity:.15}}>♻</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:"#1f2937",marginBottom:6}}>Region wählen → Leads suchen</div>
          <div style={{fontSize:10,color:"#111827",fontFamily:"'IBM Plex Mono',monospace"}}>Hunter auto · Handelsregister auto · Nur Firmen mit Email-Muster · ≥{MIN_CONF}% Confidence</div>
        </div>}

        {done&&sorted.length>0&&<div style={{marginTop:22,padding:"12px 16px",background:"rgba(255,255,255,0.015)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:8,fontSize:10,color:"#1f2937",fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.7}}>
          ✓ Echtzeit · Hunter auto · Handelsregister auto · Nur Email-Muster · ≥{MIN_CONF}% · CSV mit Mailto-Links · KMU Info@-Strategie · Apollo Error-Erkennung
        </div>}
      </div>
    </div>
  </>;
}
