// pages/api/hunter.js
// Proxy für Hunter.io — Key bleibt serverseitig

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: "Domain fehlt" });

  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Hunter API Key nicht konfiguriert" });

  try {
    const response = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}&limit=5`
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: `Hunter Fehler ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data.data || {});
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
