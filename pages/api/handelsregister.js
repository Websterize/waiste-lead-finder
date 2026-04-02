// pages/api/handelsregister.js
// Kostenloses offenes Handelsregister — findet Geschäftsführer automatisch

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Name fehlt" });

  try {
    // offeneregister.de — kostenlose, öffentliche API
    const url = `https://www.offeneregister.de/companies/search?q=${encodeURIComponent(name)}&limit=5`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "wAIste-LeadFinder/1.0" },
    });

    if (!response.ok) {
      return res.status(200).json({ geschaeftsfuehrer: [], quelle: "handelsregister" });
    }

    const data = await response.json();
    const hits = data?.hits?.hits || data?.companies || data || [];

    const gfList = [];

    for (const hit of hits.slice(0, 3)) {
      const company = hit?._source || hit;
      const officers = company?.officers || company?.current_officers || [];

      for (const officer of officers) {
        const role = (officer?.position || officer?.role || "").toLowerCase();
        const isGF = role.includes("geschäftsführer") || role.includes("inhaber") ||
                     role.includes("vorstand") || role.includes("managing") ||
                     role.includes("director") || role.includes("ceo") ||
                     role.includes("gesellschafter");

        if (isGF && officer?.name) {
          if (!gfList.find(g => g.name === officer.name)) {
            gfList.push({
              name: officer.name,
              rolle: officer.position || officer.role || "Geschäftsführer",
            });
          }
        }
      }

      // Fallback: alle Officer wenn keine GF-Rolle gefunden
      if (gfList.length === 0 && officers.length > 0) {
        for (const officer of officers.slice(0, 2)) {
          if (officer?.name) {
            gfList.push({
              name: officer.name,
              rolle: officer.position || officer.role || "Vertreter",
            });
          }
        }
      }
    }

    return res.status(200).json({ geschaeftsfuehrer: gfList, quelle: "offeneregister.de" });
  } catch (e) {
    // Stille Fehler — kein GF gefunden ist kein Absturz
    return res.status(200).json({ geschaeftsfuehrer: [], quelle: "handelsregister", error: e.message });
  }
}
