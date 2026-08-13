// GoodsbarnX – Screen Navigation Router

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const screenEl = document.getElementById("screen-" + name);
  if (screenEl) screenEl.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const navItem = document.getElementById("nav-" + name);
  if (navItem) navItem.classList.add("active");

  window.scrollTo(0, 0);

  // Dispatch custom event so modules can react
  document.dispatchEvent(new CustomEvent("screenChanged", { detail: { screen: name } }));
}
