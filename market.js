class Market {
  static async render(container) {
    container.innerHTML = `
      <div class="screen active">
        <div id="onboarding-banner"></div>
        <div class="hero">
          <div class="hero-eyebrow">GoodsbarnX Network</div>
          <div class="hero-headline">Real inquiries.<br><em>Real distributors and buyers.</em></div>
          <div class="clock-seal">
            <div class="seal-ring">
              <svg width="56" height="56" viewBox="0 0 56 56">
                <circle class="bg" cx="28" cy="28" r="24" fill="none" stroke-width="4"/>
                <circle class="fg" cx="28" cy="28" r="24" fill="none" stroke-width="4" stroke-dasharray="150" stroke-dashoffset="30"/>
              </svg>
              <div class="num" id="inquiry-count-ring">–</div>
            </div>
            <div class="clock-copy">
              <div class="clock-title">Total inquiries sent</div>
              <div class="clock-sub">Real connections made through GoodsbarnX so far</div>
            </div>
          </div>
          <div class="trust-strip">
            <div class="trust-item"><div class="n" id="stat-distributors">–</div><div class="t">Distributors</div></div>
            <div class="trust-item"><div class="n" id="stat-buyers">–</div><div class="t">Buyers</div></div>
            <div class="trust-item"><div class="n">4</div><div class="t">Markets live</div></div>
          </div>
        </div>
        
        <div id="lock-banner-holder"></div>
        <div id="distributor-tools-holder"></div>
        
        <div class="search-bar-wrap">
          <span>🔍</span>
          <input type="text" id="search-input" placeholder="Search by name, location, category…" oninput="Market.applyFilters()" />
          <span class="search-clear" id="search-clear" onclick="Market.clearSearch()">✕</span>
        </div>
        
        <div class="adv-filters">
          <select id="filter-location" class="adv-filter-select" onchange="Market.applyFilters()">
            <option value="">📍 All Locations</option>
            ${LOCATIONS.map(loc => `<option value="${loc}">${loc}</option>`).join("")}
          </select>
          <select id="filter-tier" class="adv-filter-select" onchange="Market.applyFilters()">
            <option value="">⭐ All Trust Tiers</option>
            <option value="association">Association Verified</option>
            <option value="market board">Market Board</option>
            <option value="self-attested">Self-Attested</option>
          </select>
        </div>
        
        <div class="section-label">Browse Market Verticals</div>
        <div class="category-grid">
          <div class="category-card active" onclick="Market.selectCategory('All', this)">🏪<span>All</span></div>
          ${CATEGORIES.map(cat => `
            <div class="category-card" onclick="Market.selectCategory('${cat}', this)">
              ${CATEGORY_ICONS[cat] || "📦"}<span>${cat}</span>
            </div>
          `).join("")}
        </div>
        
        <div class="section-label">Distributors <span class="mono" id="distributor-count">0</span></
