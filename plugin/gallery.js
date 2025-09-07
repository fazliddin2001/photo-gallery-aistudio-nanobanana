// gallery.js — updated to add Edit button that opens localhost:3000 with current image URL
(() => {
  const GRID_KEY = "downloaded_files_v1";
  const grid = document.getElementById("grid");
  const lb = document.getElementById("lightbox");
  const slotA = document.getElementById("slotA");
  const slotB = document.getElementById("slotB");
  const imgA = document.getElementById("imgA");
  const imgB = document.getElementById("imgB");
  const caption = document.getElementById("caption");
  const indicator = document.getElementById("indicator");
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnClose = document.getElementById("btnClose");
  const btnEdit = document.getElementById("btnEdit");
  const btnRefresh = document.getElementById("btnRefresh");
  const btnOpenTab = document.getElementById("btnOpenTab");

  let items = [];
  let index = 0;
  let animating = false;
  let showingA = true;

  function log(...args){ console.log("[gallery]", ...args); }

  async function loadItems(){
    const res = await chrome.storage.local.get(GRID_KEY);
    const arr = res[GRID_KEY] || [];
    log("storage raw:", arr);
    items = arr.filter(e => e && (e.url || e.dataUrl)).map(e => ({
      url: e.url || e.dataUrl,
      filename: e.filename || e.hash || "image"
    }));
    log("loaded items:", items.length);
  }

  function renderGrid(){
    grid.innerHTML = "";
    if (!items.length) {
      grid.innerHTML = "<p style='padding:20px;color:#9aa3ad'>No images found</p>";
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
      const card = document.createElement("div");
      card.className = "thumb";
      card.dataset.index = i;
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = it.url;
      img.alt = it.filename || `image ${i+1}`;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = it.filename || `#${i+1}`;
      card.appendChild(img);
      card.appendChild(meta);
      card.addEventListener("click", () => openLightbox(i));
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function openLightbox(i){
    if (!items.length) return;
    index = (i + items.length) % items.length;
    showingA = true;
    slotA.style.transform = "translateX(0%)";
    slotB.style.transform = "translateX(100%)";
    imgA.src = items[index].url;
    imgB.src = "";
    caption.textContent = items[index].filename || "";
    indicator.textContent = `${index+1} / ${items.length}`;
    lb.classList.add("show");
    document.body.style.overflow = "hidden";
    preloadAround(index);
  }

  function closeLightbox(){
    lb.classList.remove("show");
    document.body.style.overflow = "";
  }

  function slide(direction){
    if (animating || items.length <= 1) return;
    animating = true;
    const nextIndex = (index + direction + items.length) % items.length;
    const incomingSlot = showingA ? slotB : slotA;
    const incomingImg = showingA ? imgB : imgA;
    const outgoingSlot = showingA ? slotA : slotB;
    incomingImg.src = items[nextIndex].url;
    incomingImg.alt = items[nextIndex].filename || "";
    incomingSlot.style.transition = "none";
    outgoingSlot.style.transition = "none";
    if (direction === 1){
      incomingSlot.style.transform = "translateX(100%)";
    } else {
      incomingSlot.style.transform = "translateX(-100%)";
    }
    void incomingSlot.offsetWidth;
    incomingSlot.style.transition = "transform .36s cubic-bezier(.2,.8,.2,1)";
    outgoingSlot.style.transition = "transform .36s cubic-bezier(.2,.8,.2,1)";
    if (direction === 1){
      incomingSlot.style.transform = "translateX(0%)";
      outgoingSlot.style.transform = "translateX(-100%)";
    } else {
      incomingSlot.style.transform = "translateX(0%)";
      outgoingSlot.style.transform = "translateX(100%)";
    }
    setTimeout(()=>{
      showingA = !showingA;
      index = nextIndex;
      caption.textContent = items[index].filename || "";
      indicator.textContent = `${index+1} / ${items.length}`;
      animating = false;
      preloadAround(index);
    }, 380);
  }

  function gotoNext(){ slide(1); }
  function gotoPrev(){ slide(-1); }

  window.addEventListener("keydown", (e) => {
    if (!lb.classList.contains("show")) return;
    if (e.key === "ArrowRight") gotoNext();
    if (e.key === "ArrowLeft") gotoPrev();
    if (e.key === "Escape") closeLightbox();
  });

  btnNext.addEventListener("click", gotoNext);
  btnPrev.addEventListener("click", gotoPrev);
  btnClose.addEventListener("click", closeLightbox);

  lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });

  (function addSwipe(){
    let startX=0, startY=0, tracking=false;
    lb.addEventListener("pointerdown", (e)=>{ if (!lb.classList.contains("show")) return; tracking=true; startX=e.clientX; startY=e.clientY; }, {passive:true});
    lb.addEventListener("pointerup", (e)=>{ if (!tracking) return; tracking=false; const dx=e.clientX-startX, dy=e.clientY-startY; if (Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)){ if (dx<0) gotoNext(); else gotoPrev(); } }, {passive:true});
    lb.addEventListener("pointercancel", ()=>{ tracking=false; });
  })();

  function preloadAround(i){
    [ (i+1)%items.length, (i-1+items.length)%items.length ].forEach(j => {
      const it = items[j];
      if (it) { const im = new Image(); im.src = it.url; }
    });
  }

  // --- EDIT button: send only the filename to localhost:3000
btnEdit.addEventListener("click", () => {
  if (!items.length) return;
  const current = items[index];
  if (!current) return;

  // Prefer stored filename. If missing, try to derive a safe filename from the URL.
  let filename = current.filename || "";

  if (!filename) {
    try {
      const u = new URL(current.url);
      filename = (u.pathname.split("/").filter(Boolean).pop() || `image_${index}`).split("?")[0];
    } catch (e) {
      // fallback short name
      filename = `image_${index}`;
    }
  }

  // sanitize a bit (remove dangerous chars)
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);

  const target = "http://localhost:3000/?image=http://localhost:8000/" + encodeURIComponent(filename);
  console.log("[gallery] Open edit for filename:", filename, "->", target);

  try {
    chrome.tabs.create({ url: target });
  } catch (err) {
    // fallback if chrome.tabs isn't available in this context
    window.open(target, "_blank");
  }
});


  // refresh/render
  async function refresh(){
    await loadItems();
    renderGrid();
    chrome.storage.local.get(GRID_KEY).then(res => console.log("[storage]", res));
  }

  btnRefresh.addEventListener("click", refresh);
  btnOpenTab.addEventListener("click", ()=> chrome.tabs.create({ url: chrome.runtime.getURL("gallery.html") }));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[GRID_KEY]) refresh();
  });

  refresh();

})();
