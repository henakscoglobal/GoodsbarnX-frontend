async function loadDistributorsAndBuyers() {
  // Fetch ranked distributors
  const { data: distributors, error: distError } = await sb
    .from('distributor_ranking')
    .select('*')
    .order('tier_priority', { ascending: false })   // highest tier first
    .order('response_speed', { ascending: true })   // fastest response first
    .order('successful_inquiries', { ascending: false })
    .order('profile_completeness', { ascending: false })
    .order('last_activity', { ascending: false });

  if (distError || !distributors) {
    document.getElementById("distributor-list").innerHTML = '<div class="loading-text">Could not load distributors.</div>';
  } else {
    allDistributors = distributors;
    document.getElementById("distributor-count").innerText = allDistributors.length;
    document.getElementById("stat-distributors").innerText = allDistributors.length;
    renderDistributors(allDistributors);
  }

  function applyFilters() {
  const q = document.getElementById("search-input").value.trim().toLowerCase();

  const fd = allDistributors.filter(d => {
    const mc = activeCategory === "All" || (d.category && d.category.trim() === activeCategory);
    const ms = !q || 
      (d.business_name || "").toLowerCase().includes(q) ||
      (d.location || "").toLowerCase().includes(q) ||
      (d.category || "").toLowerCase().includes(q);
    return mc && ms;
  });

  const fb = allBuyers.filter(b => {
    const bName = b.profiles ? b.profiles.full_name : "";
    const mc = activeCategory === "All" || (b.looking_for && b.looking_for.trim() === activeCategory);
    const ms = !q ||
      (bName || "").toLowerCase().includes(q) ||
      (b.location || "").toLowerCase().includes(q) ||
      (b.looking_for || "").toLowerCase().includes(q);
    return mc && ms;
  });

  renderDistributors(fd);
  renderBuyers(fb);
  document.getElementById("distributor-count").innerText = fd.length;
  document.getElementById("buyer-count").innerText = fb.length;
  }

  // Buyers remain unchanged – no ranking needed for buyers
  const { data: buyers, error: buyerError } = await sb
    .from("buyer_profiles")
    .select("id, location, looking_for, profiles(full_name, phone)");
  if (buyerError || !buyers) {
    document.getElementById("buyer-list").innerHTML = '<div class="loading-text">Could not load buyers.</div>';
  } else {
    allBuyers = buyers;
    document.getElementById("buyer-count").innerText = allBuyers.length;
    document.getElementById("stat-buyers").innerText = allBuyers.length;
    renderBuyers(allBuyers);
  }
}
