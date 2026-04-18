// MLB team name → standardized 3-letter abbreviation mapping
// Used to normalize team names from both MLB Stats API and Odds API
// team_id values MUST match what is seeded into team_power_ratings

// Primary map: MLB Stats API team names (exact as returned by /schedule endpoint)
export const MLB_TEAM_MAP = {
  // American League East
  'New York Yankees':    'NYY',
  'Boston Red Sox':      'BOS',
  'Toronto Blue Jays':   'TOR',
  'Tampa Bay Rays':      'TB',
  'Baltimore Orioles':   'BAL',

  // American League Central
  'Chicago White Sox':   'CHW',
  'Cleveland Guardians': 'CLE',
  'Detroit Tigers':      'DET',
  'Kansas City Royals':  'KC',
  'Minnesota Twins':     'MIN',

  // American League West
  'Houston Astros':      'HOU',
  'Los Angeles Angels':  'LAA',
  'Oakland Athletics':   'OAK',
  'Seattle Mariners':    'SEA',
  'Texas Rangers':       'TEX',

  // National League East
  'Atlanta Braves':      'ATL',
  'Miami Marlins':       'MIA',
  'New York Mets':       'NYM',
  'Philadelphia Phillies': 'PHI',
  'Washington Nationals': 'WSH',

  // National League Central
  'Chicago Cubs':        'CHC',
  'Cincinnati Reds':     'CIN',
  'Milwaukee Brewers':   'MIL',
  'Pittsburgh Pirates':  'PIT',
  'St. Louis Cardinals': 'STL',

  // National League West
  'Arizona Diamondbacks': 'ARI',
  'Colorado Rockies':    'COL',
  'Los Angeles Dodgers': 'LAD',
  'San Diego Padres':    'SD',
  'San Francisco Giants': 'SF',

  // Athletics alternate name variants (team relocated — APIs may use either)
  'Athletics':           'OAK',
};

// Odds API uses abbreviated city names — map those too
export const ODDS_API_TEAM_MAP = {
  'New York Yankees':    'NYY',
  'Boston Red Sox':      'BOS',
  'Toronto Blue Jays':   'TOR',
  'Tampa Bay Rays':      'TB',
  'Baltimore Orioles':   'BAL',
  'Chicago White Sox':   'CHW',
  'Cleveland Guardians': 'CLE',
  'Detroit Tigers':      'DET',
  'Kansas City Royals':  'KC',
  'Minnesota Twins':     'MIN',
  'Houston Astros':      'HOU',
  'Los Angeles Angels':  'LAA',
  'Oakland Athletics':   'OAK',
  'Athletics':           'OAK',
  'Seattle Mariners':    'SEA',
  'Texas Rangers':       'TEX',
  'Atlanta Braves':      'ATL',
  'Miami Marlins':       'MIA',
  'New York Mets':       'NYM',
  'Philadelphia Phillies': 'PHI',
  'Washington Nationals': 'WSH',
  'Chicago Cubs':        'CHC',
  'Cincinnati Reds':     'CIN',
  'Milwaukee Brewers':   'MIL',
  'Pittsburgh Pirates':  'PIT',
  'St. Louis Cardinals': 'STL',
  'Arizona Diamondbacks': 'ARI',
  'Colorado Rockies':    'COL',
  'Los Angeles Dodgers': 'LAD',
  'San Diego Padres':    'SD',
  'San Francisco Giants': 'SF',
};

// Normalize a team name to abbreviation — tries exact match, then fuzzy
export function normalizeTeam(name, map = MLB_TEAM_MAP) {
  if (!name) return null;
  // Exact match
  if (map[name]) return map[name];
  // Case-insensitive
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (key.toLowerCase() === lower) return val;
  }
  // Partial match (e.g. "Dodgers" → "Los Angeles Dodgers")
  for (const [key, val] of Object.entries(map)) {
    const parts = key.toLowerCase().split(' ');
    if (parts.some(p => p.length > 4 && lower.includes(p))) return val;
  }
  return null;
}

// Check if two team names refer to the same team (for game matching)
export function teamsMatch(nameA, nameB) {
  const a = normalizeTeam(nameA, { ...MLB_TEAM_MAP, ...ODDS_API_TEAM_MAP });
  const b = normalizeTeam(nameB, { ...MLB_TEAM_MAP, ...ODDS_API_TEAM_MAP });
  return a && b && a === b;
}
