// pages/api/places-detail.js
// Lädt Reviews für eine einzelne Firma — Key bleibt serverseitig

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { placeId } = req.query;
  if (!placeId) return res.status(400).json({ error: "placeId fehlt" });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Google API Key nicht konfiguriert" });

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?languageCode=de`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "reviews,rating,userRatingCount",
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ reviews: [] });
    }

    const data = await response.json();
    return res.status(200).json({
      reviews: data.reviews || [],
      rating: data.rating,
      reviewCount: data.userRatingCount,
    });
  } catch (e) {
    return res.status(500).json({ reviews: [], error: e.message });
  }
}
