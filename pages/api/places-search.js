// pages/api/places-search.js
// Server-seitig: API Key bleibt komplett serverseitig, Mitarbeiter sehen ihn nie

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Query fehlt" });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Google API Key nicht konfiguriert (Vercel Environment Variables prüfen)" });

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.rating",
          "places.userRatingCount",
          "places.websiteUri",
          "places.nationalPhoneNumber",
          "places.businessStatus",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "de",
        regionCode: "DE",
        maxResultCount: 20,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err?.error?.message || `Google API Fehler ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message || "Interner Fehler" });
  }
}
