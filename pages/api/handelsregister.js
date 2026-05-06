// pages/api/handelsregister.js
// Proxy to offeneregister.de - kostenlos, kein API Key nötig

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "name fehlt" });

  try {
    const searchUrl = `https://api.offeneregister.de/companies?q=${encodeURIComponent(name)}&limit=5`;
    const response = await fetch(searchUrl, {
      headers: { "Accept": "application/json", "User-Agent": "waiste-lead-finder/1.0" },
    });

    if (!response.ok) {
      return res.status(200).json({ geschaeftsfuehrer: [], found: false });
    }

    const data = await response.json();
    const companies = data?.items || data?.data || data || [];

    if (!Array.isArray(companies) || companies.length === 0) {
      return res.status(200).json({ geschaeftsfuehrer: [], found: false });
    }

    // Find best match by name similarity
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const nameLower = normalize(name);
    let bestMatch = companies[0];
    for (const c of companies) {
      const cn = normalize(c.name || c.company_name || "");
      if (cn.includes(nameLower) || nameLower.includes(cn)) { bestMatch = c; break; }
    }

    // Extract officers / Geschäftsführer
    const officers = bestMatch?.officers || bestMatch?.directors || bestMatch?.management || [];
    const gf = officers
      .filter(o => {
        const pos = (o.position || o.role || o.type || "").toLowerCase();
        return pos.includes("geschäftsführ") || pos.includes("inhaber") ||
               pos.includes("vorstand") || pos.includes("director") ||
               pos.includes("managing") || pos.includes("ceo") || pos === "";
      })
      .map(o => ({
        name: o.name || o.full_name || `${o.first_name || ""} ${o.last_name || ""}`.trim(),
        position: o.position || o.role || "Geschäftsführer",
      }))
      .filter(o => o.name && o.name.length > 2)
      .slice(0, 3);

    return res.status(200).json({
      geschaeftsfuehrer: gf,
      companyName: bestMatch?.name || bestMatch?.company_name || name,
      found: gf.length > 0,
    });

  } catch (e) {
    // Fail silently — Handelsregister ist optional
    return res.status(200).json({ geschaeftsfuehrer: [], found: false, error: e.message });
  }
}
