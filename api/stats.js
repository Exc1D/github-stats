const fetch = require("node-fetch");

async function fetchGitHubData(username) {
  const token = process.env.GITHUB_TOKEN || "";
  const headers = {
    Authorization: token ? `token ${token}` : "",
    "Content-Type": "application/json",
  };

  // First get user creation date
  const userResponse = await fetch(`https://api.github.com/users/${username}`, {
    headers,
  });
  const userData = await userResponse.json();
  const createdAt = userData.created_at;

  const query = `
    query($username: String!) {
      user(login: $username) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
        repositories(first: 100, ownerAffiliations: OWNER, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            stargazerCount
            forkCount
            languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
              edges {
                size
                node {
                  name
                  color
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables: { username } }),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch GitHub data");
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0].message);
  }

  return {
    calendar: data.data.user.contributionsCollection.contributionCalendar,
    repositories: data.data.user.repositories.nodes,
    createdAt: createdAt,
  };
}

function calculateLanguageStats(repositories) {
  const languageMap = {};

  repositories.forEach((repo) => {
    repo.languages.edges.forEach((edge) => {
      const { name, color } = edge.node;
      const { size } = edge;

      if (languageMap[name]) {
        languageMap[name].size += size;
      } else {
        languageMap[name] = { size, color: color || "#858585" };
      }
    });
  });

  const totalSize = Object.values(languageMap).reduce(
    (sum, lang) => sum + lang.size,
    0
  );

  return Object.entries(languageMap)
    .map(([name, data]) => ({
      name,
      color: data.color,
      percentage: ((data.size / totalSize) * 100).toFixed(2),
      size: data.size,
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 5);
}

function calculateStreaks(weeks) {
  const allDays = weeks.flatMap((week) => week.contributionDays);

  if (allDays.length === 0) {
    return {
      current: 0,
      currentStart: null,
      longest: 0,
      longestStart: null,
      longestEnd: null,
    };
  }

  // Get today's date in UTC (same as GitHub's contribution graph)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  let longestStreak = 0;
  let longestStreakStart = null;
  let longestStreakEnd = null;

  let currentStreak = 0;
  let currentStreakStart = null;

  let tempStreak = 0;
  let tempStreakStart = null;

  // Iterate through all days from oldest to newest
  for (let i = 0; i < allDays.length; i++) {
    const day = allDays[i];
    const dayDate = new Date(day.date + "T00:00:00Z");

    if (day.contributionCount > 0) {
      if (tempStreak === 0) {
        tempStreakStart = day.date;
      }
      tempStreak++;

      // Update longest streak if current temp streak is longer
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
        longestStreakStart = tempStreakStart;
        longestStreakEnd = day.date;
      }
    } else {
      // Reset temp streak when we hit a day with no contributions
      tempStreak = 0;
      tempStreakStart = null;
    }
  }

  // Calculate current streak by iterating backwards from today
  for (let i = allDays.length - 1; i >= 0; i--) {
    const day = allDays[i];
    const dayDate = new Date(day.date + "T00:00:00Z");

    // Stop if we've gone past today (shouldn't happen, but safety check)
    if (dayDate > today) continue;

    if (day.contributionCount > 0) {
      currentStreak++;
      currentStreakStart = day.date;
    } else {
      // If we hit a day with no contributions
      // Only break if this is not today (to preserve streak if user hasn't contributed yet today)
      if (day.date !== todayStr) {
        break;
      }
    }
  }

  return {
    current: currentStreak,
    currentStart: currentStreakStart || todayStr,
    longest: longestStreak,
    longestStart: longestStreakStart || allDays[0]?.date || todayStr,
    longestEnd: longestStreakEnd || todayStr,
  };
}

function getLast90Days(weeks) {
  const allDays = weeks.flatMap((week) => week.contributionDays);
  return allDays.slice(-90);
}

function formatDate(dateStr) {
  const date = new Date(dateStr + "T00:00:00Z");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getAccountCreationDate(createdAt) {
  const date = new Date(createdAt);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function calculateRepoStats(repositories) {
  const totalStars = repositories.reduce(
    (sum, repo) => sum + repo.stargazerCount,
    0
  );
  const totalForks = repositories.reduce(
    (sum, repo) => sum + repo.forkCount,
    0
  );
  return { totalStars, totalForks };
}

function generateSVG(
  totalContributions,
  streaks,
  activityDays,
  languages,
  createdAt,
  repoStats
) {
  const width = 800;
  const height = 760;
  const graphWidth = 720;
  const graphHeight = 140;
  const padding = 30;

  const maxContributions = Math.max(
    ...activityDays.map((d) => d.contributionCount),
    1
  );

  // Generate smooth curve path for activity graph using quadratic bezier curves
  const points = activityDays.map((day, index) => {
    const x =
      padding +
      (index / (activityDays.length - 1)) * (graphWidth - 2 * padding);
    const y =
      graphHeight -
      padding -
      (day.contributionCount / maxContributions) * (graphHeight - 2 * padding);
    return { x, y, count: day.contributionCount };
  });

  // Create smooth curve using quadratic bezier
  let linePath = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    linePath += ` Q ${prev.x},${prev.y} ${midX},${(prev.y + curr.y) / 2}`;
    if (i === points.length - 1) {
      linePath += ` Q ${curr.x},${curr.y} ${curr.x},${curr.y}`;
    }
  }

  const areaPath = `${linePath} L ${graphWidth - padding},${
    graphHeight - padding
  } L ${padding},${graphHeight - padding} Z`;

  // Generate grid lines
  const gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i * (graphHeight - 2 * padding)) / 4;
    const value = Math.round(maxContributions * (1 - i / 4));
    gridLines.push(
      `<line x1="${padding}" y1="${y}" x2="${
        graphWidth - padding
      }" y2="${y}" class="grid-line"/>
      <text x="${padding - 15}" y="${
        y + 4
      }" class="axis-label" text-anchor="end">${value}</text>`
    );
  }

  const accountCreated = getAccountCreationDate(createdAt);
  const longestStartDate = formatDate(streaks.longestStart);
  const longestEndDate = formatDate(streaks.longestEnd);
  const currentStartDate = formatDate(streaks.currentStart);

  // Generate language bar
  let currentX = 0;
  const barWidth = 720;
  const barY = 580;
  const barHeight = 32;
  const languageBarSegments = languages
    .map((lang, index) => {
      const segmentWidth = (parseFloat(lang.percentage) / 100) * barWidth;
      const isFirst = index === 0;
      const isLast = index === languages.length - 1;
      const rx = isFirst || isLast ? 6 : 0;
      const segment = `<rect x="${
        currentX + 40
      }" y="${barY}" width="${segmentWidth}" height="${barHeight}" fill="${
        lang.color
      }" rx="${rx}"/>`;
      currentX += segmentWidth;
      return segment;
    })
    .join("");

  // Generate language list with improved layout
  const languageList = languages
    .map((lang, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const x = col === 0 ? 100 : 450;
      const y = 645 + row * 42;

      return `
        <circle cx="${x - 45}" cy="${y - 4}" r="7" fill="${lang.color}"/>
        <text x="${x}" y="${y}" class="text lang-text">${lang.name}</text>
        <text x="${
          x + 230
        }" y="${y}" class="text lang-percentage" text-anchor="end">${
        lang.percentage
      }%</text>
      `;
    })
    .join("");

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    @media (prefers-color-scheme: dark) {
      .bg { fill: #0d1117; }
      .text { fill: #e6edf3; }
      .border { stroke: #30363d; }
      .grid-line { stroke: #21262d; }
      .axis-label { fill: #7d8590; }
      .section-bg { fill: #161b22; }
    }
    @media (prefers-color-scheme: light) {
      .bg { fill: #ffffff; }
      .text { fill: #24292f; }
      .border { stroke: #d0d7de; }
      .grid-line { stroke: #e6e9ed; }
      .axis-label { fill: #57606a; }
      .section-bg { fill: #f6f8fa; }
    }
    .stat-number { font-size: 52px; font-weight: bold; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .stat-label { font-size: 15px; font-weight: 600; letter-spacing: 0.3px; }
    .stat-detail { font-size: 12px; opacity: 0.75; }
    .lang-text { font-size: 15px; font-weight: 500; }
    .lang-percentage { font-size: 16px; font-weight: 600; opacity: 0.8; }
    .section-title { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
    .accent-red { fill: #f85149; }
    .accent-blue { fill: #58a6ff; }
    .accent-green { fill: #3fb950; }
    .accent-purple { fill: #a371f7; }
    .graph-line { stroke: #3fb950; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .graph-area { fill: url(#gradient); opacity: 0.3; }
    .grid-line { stroke-width: 1; opacity: 0.3; }
    .axis-label { font-size: 11px; font-weight: 500; }
    .text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  </style>
  
  <defs>
    <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#3fb950;stop-opacity:0.8" />
      <stop offset="100%" style="stop-color:#3fb950;stop-opacity:0.1" />
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="1" stdDeviation="3" flood-opacity="0.15"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="${width}" height="${height}" class="bg" rx="12"/>
  
  <!-- Stats Container -->
  <rect x="10" y="10" width="780" height="160" class="section-bg" rx="10"/>
  <rect x="10" y="10" width="780" height="160" fill="none" class="border" stroke-width="2" rx="10"/>
  
  <!-- Total Contributions -->
  <g transform="translate(140, 90)">
    <circle cx="0" cy="0" r="50" class="accent-red" opacity="0.12"/>
    <text x="0" y="8" class="text stat-number accent-red" text-anchor="middle">${totalContributions.toLocaleString()}</text>
    <text x="0" y="31" class="accent-red stat-label" text-anchor="middle">Total Contributions</text>
    <text x="0" y="50" class="text stat-detail" text-anchor="middle">${accountCreated} - Present</text>
  </g>
  
  <!-- Current Streak -->
  <g transform="translate(400, 90)">
    <circle cx="0" cy="0" r="50" class="accent-blue" opacity="0.12"/>
    <path d="M -8 -22 Q -8 -27 -3 -27 L -3 -32 Q -3 -37 -8 -37 Q -13 -37 -13 -32 L -13 -27 Q -13 -27 -8 -22 M 8 -22 Q 8 -27 3 -27 L 3 -32 Q 3 -37 8 -37 Q 13 -37 13 -32 L 13 -27 Q 13 -27 8 -22 Z" class="accent-blue" opacity="0.7"/>
    <text x="0" y="8" class="text stat-number accent-blue" text-anchor="middle">${
      streaks.current
    }</text>
    <text x="0" y="31" class="accent-blue stat-label" text-anchor="middle">Current Streak</text>
    <text x="0" y="50" class="text stat-detail" text-anchor="middle">${currentStartDate} - Present</text>
  </g>
  
  <!-- Longest Streak -->
  <g transform="translate(660, 90)">
    <circle cx="0" cy="0" r="50" class="accent-purple" opacity="0.12"/>
    <text x="0" y="8" class="text stat-number accent-purple" text-anchor="middle">${
      streaks.longest
    }</text>
    <text x="0" y="31" class="accent-purple stat-label" text-anchor="middle">Longest Streak</text>
    <text x="0" y="50" class="text stat-detail" text-anchor="middle">${longestStartDate} - ${longestEndDate}</text>
  </g>
  
  <!-- Dividers -->
  <line x1="270" y1="30" x2="270" y2="150" class="border" stroke-width="2" opacity="0.3"/>
  <line x1="530" y1="30" x2="530" y2="150" class="border" stroke-width="2" opacity="0.3"/>
  
  <!-- Activity Graph Container -->
  <rect x="10" y="190" width="780" height="190" class="section-bg" rx="10"/>
  <rect x="10" y="190" width="780" height="190" fill="none" class="border" stroke-width="2" rx="10"/>
  
  <!-- Activity Graph Title -->
  <text x="30" y="218" class="text section-title">Contribution Activity (Last 90 Days)</text>
  
  <!-- Activity Graph -->
  <g transform="translate(30, 240)">
    <!-- Grid lines -->
    ${gridLines.join("")}
    
    <!-- Graph area and line -->
    <path d="${areaPath}" class="graph-area"/>
    <path d="${linePath}" class="graph-line"/>
    
    <!-- Axes -->
    <line x1="${padding}" y1="${graphHeight - padding}" x2="${
    graphWidth - padding
  }" y2="${graphHeight - padding}" class="border" stroke-width="2"/>
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${
    graphHeight - padding
  }" class="border" stroke-width="2"/>
    
    <!-- Axis labels -->
    <text x="${padding + 10}" y="${
    graphHeight - 8
  }" class="axis-label">90 days ago</text>
    <text x="${graphWidth - padding - 10}" y="${
    graphHeight - 8
  }" class="axis-label" text-anchor="end">Today</text>
  </g>
  
  <!-- Additional Stats Container -->
  <rect x="10" y="400" width="780" height="90" class="section-bg" rx="10"/>
  <rect x="10" y="400" width="780" height="90" fill="none" class="border" stroke-width="2" rx="10"/>
  
  <!-- Repository Stats -->
  <g transform="translate(0, 455)">
    <text x="200" y="0" class="text stat-number accent-blue" text-anchor="middle">${repoStats.totalStars.toLocaleString()}</text>
    <text x="200" y="22" class="accent-blue stat-label" text-anchor="middle">Total Stars</text>
    
    <text x="400" y="0" class="text stat-number accent-purple" text-anchor="middle">${repoStats.totalForks.toLocaleString()}</text>
    <text x="400" y="22" class="accent-purple stat-label" text-anchor="middle">Total Forks</text>
    
    <text x="600" y="0" class="text stat-number accent-green" text-anchor="middle">${
      languages.length
    }</text>
    <text x="600" y="22" class="accent-green stat-label" text-anchor="middle">Languages Used</text>
  </g>
  
  <line x1="310" y1="415" x2="310" y2="475" class="border" stroke-width="2" opacity="0.3"/>
  <line x1="490" y1="415" x2="490" y2="475" class="border" stroke-width="2" opacity="0.3"/>
  
  <!-- Languages Container -->
  <rect x="10" y="510" width="780" height="240" class="section-bg" rx="10"/>
  <rect x="10" y="510" width="780" height="240" fill="none" class="border" stroke-width="2" rx="10"/>
  
  <!-- Languages Title -->
  <text x="30" y="538" class="accent-green section-title">Most Used Languages</text>
  
  <!-- Language Bar -->
  <g>
    ${languageBarSegments}
  </g>
  
  <!-- Language List -->
  <g>
    ${languageList}
  </g>
</svg>
  `.trim();
}

module.exports = async (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).send("Username parameter is required");
    }

    const { calendar, repositories, createdAt } = await fetchGitHubData(
      username
    );
    const streaks = calculateStreaks(calendar.weeks);
    const activityDays = getLast90Days(calendar.weeks);
    const languages = calculateLanguageStats(repositories);
    const repoStats = calculateRepoStats(repositories);

    const svg = generateSVG(
      calendar.totalContributions,
      streaks,
      activityDays,
      languages,
      createdAt,
      repoStats
    );

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=14400");
    res.status(200).send(svg);
  } catch (error) {
    console.error("Error generating stats:", error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
};
