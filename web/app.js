// Cuy Pay landing — modal + demo auth (frontend only, datos simulados)
(function () {
  const modal = document.getElementById("authModal");
  const form = document.getElementById("authForm");
  const formMsg = document.getElementById("formMsg");
  const submitBtn = document.getElementById("submitBtn");
  const success = document.getElementById("authSuccess");
  const successTitle = document.getElementById("successTitle");
  const successText = document.getElementById("successText");
  const tabs = document.querySelectorAll(".tab");
  let mode = "login";

  function setMode(next) {
    mode = next;
    modal.classList.toggle("mode-register", mode === "register");
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === mode));
    submitBtn.textContent = mode === "register" ? "Crear cuenta" : "Ingresar";
    formMsg.textContent = "";
  }

  function openModal(next) {
    setMode(next || "login");
    form.hidden = false;
    success.hidden = true;
    form.reset();
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  // Open triggers
  document.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => openModal(el.dataset.open));
  });
  // Close triggers
  document.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
  });
  // Tabs
  tabs.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.tab)));

  // Submit (demo)
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = (data.get("name") || "").toString().trim();
    const email = (data.get("email") || "").toString().trim();
    const password = (data.get("password") || "").toString();

    if (!email || !password) {
      formMsg.textContent = "Completa email y contraseña.";
      return;
    }
    if (password.length < 6) {
      formMsg.textContent = "La contraseña debe tener al menos 6 caracteres.";
      return;
    }
    if (mode === "register" && !name) {
      formMsg.textContent = "Ingresa tu nombre.";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Procesando…";

    // Simula una llamada al backend
    setTimeout(() => {
      submitBtn.disabled = false;
      const displayName = name || email.split("@")[0];
      successTitle.textContent =
        mode === "register" ? "¡Cuenta creada! 🎉" : `Hola de nuevo, ${displayName}`;
      successText.textContent =
        mode === "register"
          ? "Tu billetera Cuy Pay está lista para usarse."
          : "Iniciaste sesión correctamente.";
      form.hidden = true;
      success.hidden = false;
    }, 700);
  });

  // Footer year (in case it's updated)
  const copy = document.querySelector(".copy");
  if (copy) copy.textContent = copy.textContent.replace("2026", new Date().getFullYear());
})();
