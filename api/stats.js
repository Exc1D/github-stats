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

  let currentStreak = 0;
  let currentStreakStart = null;
  let longestStreak = 0;
  let longestStreakStart = null;
  let longestStreakEnd = null;

  let tempStreak = 0;
  let tempStreakStart = null;
  let tempStreakEnd = null;

  // Check if the most recent day (last day) has contributions
  const lastDay = allDays[allDays.length - 1];
  const hasContributionToday = lastDay.contributionCount > 0;

  // Iterate backwards from the most recent day
  for (let i = allDays.length - 1; i >= 0; i--) {
    const day = allDays[i];

    if (day.contributionCount > 0) {
      if (tempStreak === 0) {
        tempStreakEnd = day.date;
      }
      tempStreak++;
      tempStreakStart = day.date;

      // Track longest streak
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
        longestStreakStart = tempStreakStart;
        longestStreakEnd = tempStreakEnd;
      }

      // Set current streak if we're still counting from the most recent day
      if (hasContributionToday && currentStreak === 0) {
        currentStreak = tempStreak;
        currentStreakStart = tempStreakStart;
      }
    } else {
      // Streak broken - stop counting current streak
      if (
        hasContributionToday &&
        currentStreak === 0 &&
        i < allDays.length - 1
      ) {
        // We've hit the first gap after the current streak
        break;
      }

      tempStreak = 0;
      tempStreakStart = null;
      tempStreakEnd = null;
    }
  }

  // If we made it through the entire loop and had contributions on the last day
  if (hasContributionToday && currentStreak === 0 && tempStreak > 0) {
    currentStreak = tempStreak;
    currentStreakStart = tempStreakStart;
  }

  const today = new Date().toISOString().split("T")[0];

  return {
    current: currentStreak,
    currentStart: currentStreakStart || today,
    longest: longestStreak,
    longestStart: longestStreakStart || allDays[0]?.date || today,
    longestEnd: longestStreakEnd || today,
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

function generateSVG(
  totalContributions,
  streaks,
  activityDays,
  languages,
  createdAt
) {
  const width = 800;
  const height = 680;
  const graphWidth = 720;
  const graphHeight = 120;
  const padding = 30;

  const maxContributions = Math.max(
    ...activityDays.map((d) => d.contributionCount),
    1
  );

  // Generate line path for activity graph
  const points = activityDays.map((day, index) => {
    const x =
      padding +
      (index / (activityDays.length - 1)) * (graphWidth - 2 * padding);
    const y =
      graphHeight -
      padding -
      (day.contributionCount / maxContributions) * (graphHeight - 2 * padding);
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${graphWidth - padding},${
    graphHeight - padding
  } L ${padding},${graphHeight - padding} Z`;

  // Generate grid lines for activity graph
  const gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i * (graphHeight - 2 * padding)) / 4;
    gridLines.push(
      `<line x1="${padding}" y1="${y}" x2="${
        graphWidth - padding
      }" y2="${y}" class="grid-line"/>`
    );
  }

  const accountCreated = getAccountCreationDate(createdAt);
  const longestStartDate = formatDate(streaks.longestStart);
  const longestEndDate = formatDate(streaks.longestEnd);
  const currentStartDate = formatDate(streaks.currentStart);

  // Generate language bar segments with proper spacing
  let currentX = 0;
  const barWidth = 720;
  const barY = 420;
  const barHeight = 28;
  const languageBarSegments = languages
    .map((lang, index) => {
      const segmentWidth = (parseFloat(lang.percentage) / 100) * barWidth;
      const isFirst = index === 0;
      const isLast = index === languages.length - 1;
      const rx = isFirst || isLast ? 4 : 0;
      const segment = `<rect x="${
        currentX + 40
      }" y="${barY}" width="${segmentWidth}" height="${barHeight}" fill="${
        lang.color
      }" rx="${rx}"/>`;
      currentX += segmentWidth;
      return segment;
    })
    .join("");

  // Generate language list in two columns with better spacing
  const languageList = languages
    .map((lang, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const x = col === 0 ? 100 : 450;
      const y = 485 + row * 38;

      return `
        <circle cx="${x - 40}" cy="${y - 3}" r="6" fill="${lang.color}"/>
        <text x="${x}" y="${y}" class="text lang-text">${lang.name}</text>
        <text x="${x + 200}" y="${y}" class="text lang-percentage">${
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
      .text { fill: #c9d1d9; }
      .border { stroke: #30363d; }
      .grid-line { stroke: #21262d; }
      .axis-label { fill: #8b949e; }
    }
    @media (prefers-color-scheme: light) {
      .bg { fill: #ffffff; }
      .text { fill: #24292f; }
      .border { stroke: #d0d7de; }
      .grid-line { stroke: #e6e9ed; }
      .axis-label { fill: #57606a; }
    }
    .stat-number { font-size: 48px; font-weight: bold; }
    .stat-label { font-size: 16px; }
    .stat-detail { font-size: 12px; opacity: 0.8; }
    .lang-text { font-size: 16px; font-weight: 500; }
    .lang-percentage { font-size: 16px; opacity: 0.7; font-weight: 600; }
    .section-title { font-size: 20px; font-weight: 600; letter-spacing: -0.5px; }
    .accent { fill: #f85149; }
    .blue { fill: #58a6ff; }
    .graph-line { stroke: #3fb950; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .graph-area { fill: #3fb95020; }
    .grid-line { stroke-width: 1; opacity: 0.25; }
    .axis-label { font-size: 12px; opacity: 0.7; }
  </style>
  
  <!-- Background -->
  <rect width="${width}" height="${height}" class="bg" rx="10"/>
  
  <!-- Stats Container -->
  <rect x="10" y="10" width="780" height="140" fill="none" class="border" stroke-width="2" rx="8"/>
  
  <!-- Total Contributions -->
  <text x="140" y="75" class="text stat-number" text-anchor="middle">${totalContributions.toLocaleString()}</text>
  <text x="140" y="100" class="accent stat-label" text-anchor="middle">Total Contributions</text>
  <text x="140" y="125" class="text stat-detail" text-anchor="middle">${accountCreated} - Present</text>
  
  <!-- Current Streak with flame icon -->
  <circle cx="400" cy="65" r="42" class="accent" opacity="0.15"/>
  <path d="M 400 42 Q 400 37 405 37 L 405 32 Q 405 27 400 27 Q 395 27 395 32 L 395 37 Q 395 37 400 42 Z" class="accent" transform="translate(0, 5)"/>
  <text x="400" y="75" class="text stat-number" text-anchor="middle">${
    streaks.current
  }</text>
  <text x="400" y="100" class="blue stat-label" text-anchor="middle">Current Streak</text>
  <text x="400" y="125" class="text stat-detail" text-anchor="middle">${currentStartDate} - Present</text>
  
  <!-- Longest Streak -->
  <text x="660" y="75" class="text stat-number" text-anchor="middle">${
    streaks.longest
  }</text>
  <text x="660" y="100" class="accent stat-label" text-anchor="middle">Longest Streak</text>
  <text x="660" y="125" class="text stat-detail" text-anchor="middle">${longestStartDate} - ${longestEndDate}</text>
  
  <!-- Dividers -->
  <line x1="270" y1="30" x2="270" y2="130" class="border" stroke-width="2"/>
  <line x1="530" y1="30" x2="530" y2="130" class="border" stroke-width="2"/>
  
  <!-- Activity Graph Container -->
  <rect x="10" y="170" width="780" height="170" fill="none" class="border" stroke-width="2" rx="8"/>
  
  <!-- Activity Graph Title -->
  <text x="30" y="195" class="text section-title">Contribution Activity (Last 90 Days)</text>
  
  <!-- Activity Graph -->
  <g transform="translate(30, 200)">
    <!-- Grid lines -->
    ${gridLines.join("")}
    
    <!-- Graph area and line -->
    <path d="${areaPath}" class="graph-area"/>
    <path d="${linePath}" class="graph-line"/>
    
    <!-- Axes -->
    <line x1="${padding}" y1="${graphHeight - padding}" x2="${
    graphWidth - padding
  }" y2="${graphHeight - padding}" class="border" stroke-width="1.5"/>
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${
    graphHeight - padding
  }" class="border" stroke-width="1.5"/>
    
    <!-- Axis labels -->
    <text x="${padding}" y="${
    graphHeight - 5
  }" class="axis-label" text-anchor="start">90 days ago</text>
    <text x="${graphWidth - padding}" y="${
    graphHeight - 5
  }" class="axis-label" text-anchor="end">Today</text>
    <text x="${padding - 10}" y="${
    padding + 5
  }" class="axis-label" text-anchor="end">${maxContributions}</text>
    <text x="${padding - 10}" y="${
    graphHeight - padding
  }" class="axis-label" text-anchor="end">0</text>
  </g>
  
  <!-- Languages Container -->
  <rect x="10" y="360" width="780" height="300" fill="none" class="border" stroke-width="2" rx="8"/>
  
  <!-- Languages Title -->
  <text x="30" y="390" class="accent section-title">Most Used Languages</text>
  
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

    const svg = generateSVG(
      calendar.totalContributions,
      streaks,
      activityDays,
      languages,
      createdAt
    );

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=14400");
    res.status(200).send(svg);
  } catch (error) {
    console.error("Error generating stats:", error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
};
