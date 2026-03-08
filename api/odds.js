export default async function handler(req, res) {
  const API_KEY = process.env.ODDS_API_KEY || "8b3e87f2b2655190a02c4937baba82f0";
  const { sport, markets } = req.query;
  
  if (!sport) {
    return res.status(400).json({ error: "Missing sport parameter" });
  }

  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${API_KEY}&regions=us,us2&markets=${markets || "spreads,totals"}&oddsFormat=american`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    // Forward credit headers
    const remaining = response.headers.get("x-requests-remaining");
    const used = response.headers.get("x-requests-used");
    if (remaining) res.setHeader("x-requests-remaining", remaining);
    if (used) res.setHeader("x-requests-used", used);
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch odds", detail: err.message });
  }
}
