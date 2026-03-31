// pages/api/handelsregister.js
// Offenes Handelsregister (offeneregister.de) — kostenlos, kein API Key nötig

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Name fehlt" });

  try {
    // Step 1: Company search
    const searchRes = await fetch(
      `https://www.offeneregister.de/api/companies?q=${encodeURIComponent(name)}&jurisdiction_code=de&limit=3`,
      { headers: { "Accept": "application/json" } }
    );

    if (!searchRes.ok) return res.status(200).json({ officers: [], source: "handelsregister" });

    const searchData = await searchRes.json();
    const companies = searchData.results || [];

    if (!companies.length) return res.status(200).json({ officers: [], source: "handelsregister" });

    // Pick best match
    const company = companies[0];

    // Step 2: Fetch company detail with officers
    const detailRes = await fetch(
      `https://www.offeneregister.de/api/companies/${encodeURIComponent(company.company_number)}`,
      { headers: { "Accept": "application/json" } }
    );

    if (!detailRes.ok) return res.status(200).json({ officers: [], companyName: company.name, source: "handelsregister" });

    const detail = await detailRes.json();

    // Extract Geschäftsführer from officers list
    const allOfficers = detail.officers || [];
    const geschaeftsfuehrer = allOfficers
      .filter(o => {
        const pos = (o.position || o.role || "").toLowerCase();
        return (
          pos.includes("geschäftsführ") ||
          pos.includes("geschaeftsfuehr") ||
          pos.includes("managing director") ||
          pos.includes("inhaber") ||
          pos.includes("vorstand") ||
          pos.includes("director")
        );
      })
      .map(o => ({
        name: o.name || "",
        position: o.position || o.role || "Geschäftsführer",
      }));

    // Fallback: return all officers if no GF found
    const result = geschaeftsfuehrer.length > 0
      ? geschaeftsfuehrer
      : allOfficers.slice(0, 3).map(o => ({
          name: o.name || "",
          position: o.position || o.role || "Unbekannte Funktion",
        }));

    return res.status(200).json({
      officers: result,
      companyName: detail.name || company.name,
      companyNumber: company.company_number,
      jurisdiction: company.jurisdiction_code,
      source: "handelsregister",
    });

  } catch (e) {
    // Silently fail — non-critical enrichment
    return res.status(200).json({ officers: [], source: "handelsregister", error: e.message });
  }
}
