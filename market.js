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
