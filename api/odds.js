export default async function handler(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;
  const { sport, markets } = req.query;

  if (!API_KEY) {
    return res.status(500).json({ error: "ODDS_API_KEY not configured in Vercel environment variables" });
  }
  if (!sport) {
    return res.status(400).json({ error: "Missing sport parameter" });
  }

  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${API_KEY}&regions=us,us2&markets=${markets || "spreads,totals,h2h"}&oddsFormat=american`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const remaining = response.headers.get("x-requests-remaining");
    const used = response.headers.get("x-requests-used");
    if (remaining) res.setHeader("x-requests-remaining", remaining);
    if (used) res.setHeader("x-requests-used", used);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch odds", detail: err.message });
  }
}
