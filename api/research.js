export default async function handler(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;
  const { sport, type } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=120");

  if (!API_KEY) return res.status(500).json({ error: "API key missing" });

  try {
    if (type === "scores") {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${API_KEY}&daysFrom=3`;
      const response = await fetch(url);
      const data = await response.json();
      const remaining = response.headers.get("x-requests-remaining");
      if (remaining) res.setHeader("x-requests-remaining", remaining);
      return res.status(200).json(data);
    }

    if (type === "events") {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/?apiKey=${API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      const remaining = response.headers.get("x-requests-remaining");
      if (remaining) res.setHeader("x-requests-remaining", remaining);
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Invalid type parameter. Use: scores, events" });
  } catch (err) {
    res.status(500).json({ error: "Research fetch failed", detail: err.message });
  }
}
