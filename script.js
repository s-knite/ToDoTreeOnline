import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCo52Twg79nPkHB8wJ8-KA66KVo3tpYFhk",
  authDomain: "todotree-db.firebaseapp.com",
  databaseURL:
    "https://todotree-db-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "todotree-db",
  storageBucket: "todotree-db.firebasestorage.app",
  messagingSenderId: "314459501606",
  appId: "1:314459501606:web:6a5bbf01cc2cd376faa2e7",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const viewport = document.getElementById("viewport");
const canvas = document.getElementById("canvas");
// Canvas State
let cameraX = window.innerWidth / 2;
let cameraY = window.innerHeight / 2;
let scale = 1;
// Zoom Constraints
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
// Dragging State
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
//other
const branchColors = [
  "#ffadad",
  "#ffd6a5",
  "#fdffb6",
  "#caffbf",
  "#9bf6ff",
  "#a0c4ff",
  "#bdb2ff",
  "#ffc6ff",
];

//helpers
function getRandomColor() {
  return branchColors[Math.floor(Math.random() * branchColors.length)];
}

function focusAndSelectAll(element) {
  // Wait a fraction of a second for the browser to draw the element
  setTimeout(() => {
    // Safety check: if the element got destroyed before this runs, abort!
    if (!document.body.contains(element)) return;

    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }, 50); // 50ms delay is invisible to the user but gives the DOM time to breathe
}
// Helper to focus contenteditable elements and move cursor to the end
function focusAndPlaceCursorAtEnd(el) {
  if (!el) return;
  el.focus();
  if (
    typeof window.getSelection !== "undefined" &&
    typeof document.createRange !== "undefined"
  ) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // false means collapse to the end
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// --- Smooth Panning Engine ---
let panAnimationId = null;
// Standard ease-in-out cubic function for a smooth glide
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function panCameraTo(targetX, targetY, duration = 400) {
  // Cancel any existing animation so they don't fight
  if (panAnimationId) cancelAnimationFrame(panAnimationId);

  const startX = cameraX;
  const startY = cameraY;
  const startTime = performance.now();

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = easeInOutCubic(progress);

    cameraX = startX + (targetX - startX) * ease;
    cameraY = startY + (targetY - startY) * ease;

    updateCanvas();

    if (progress < 1) {
      panAnimationId = requestAnimationFrame(animate);
    }
  }

  panAnimationId = requestAnimationFrame(animate);
}

// --- Selection State ---
let activeNode = null;
let pendingCameraPan = false; // NEW: Tracks if the camera is waiting for layout

// Helper to handle the actual panning math
function focusActiveNodeCamera() {
  if (!activeNode) return;
  const targetX = window.innerWidth / 2 - activeNode.x * scale;
  const targetY = window.innerHeight / 2 - activeNode.y * scale;
  panCameraTo(targetX, targetY);
}

function setActiveNode(node) {
  // 1. Remove glow from previously active node
  if (activeNode && activeNode.element) {
    activeNode.element.classList.remove(
      "ring-4",
      "ring-blue-500",
      "ring-offset-4",
      "ring-offset-slate-900",
    );
  }

  activeNode = node;

  // 2. Add glow to new active node
  if (activeNode && activeNode.element) {
    activeNode.element.classList.add(
      "ring-4",
      "ring-blue-500",
      "ring-offset-4",
      "ring-offset-slate-900",
    );

    // 3. CORE FIX: If layout is calculating, queue the pan. Otherwise, pan now.
    if (layoutFrameRequest) {
      pendingCameraPan = true;
    } else {
      focusActiveNodeCamera();
    }
  }
}

/**
 * Updates the canvas transform and synchronizes the background grid.
 */
function updateCanvas() {
  // 1. Move and scale the canvas
  canvas.style.transform = `translate(${cameraX}px, ${cameraY}px) scale(${scale})`;

  // 2. Synchronize the grid background
  const gridSize = 50 * scale;
  viewport.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  viewport.style.backgroundPosition = `${cameraX}px ${cameraY}px`;
}

// --- Smart Centering ---
function findFirstIncompleteTask(nodes) {
  for (let node of nodes) {
    if (!node.isCompleted) return node;
    if (node.children.length > 0) {
      const foundInChild = findFirstIncompleteTask(node.children);
      if (foundInChild) return foundInChild;
    }
  }
  return null;
}

function recenterCamera() {
  if (rootTasks.length === 0) {
    panCameraTo(window.innerWidth / 2, window.innerHeight / 2);
    return;
  }

  // 1. Find the first incomplete task in the tree
  let targetNode = findFirstIncompleteTask(rootTasks);

  // 2. Fallback: If EVERYTHING is completed, just target the first root node
  if (!targetNode) {
    targetNode = rootTasks[0];
  }

  // 3. Reset zoom scale to 1 for a clean view, then pan to the target node
  scale = 1;

  // Set the target node as active (which automatically calls panCameraTo for us!)
  setActiveNode(targetNode);
}

// --- Event Listeners ---
viewport.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (panAnimationId) cancelAnimationFrame(panAnimationId);
    if (e.ctrlKey) {
      // Zoom Logic
      const zoomSpeed = 0.1;
      const zoomDelta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
      const newScale = Math.min(
        Math.max(scale + zoomDelta, MIN_SCALE),
        MAX_SCALE,
      );
      const scaleRatio = newScale / scale;
      const mouseXToCamera = e.clientX - cameraX;
      const mouseYToCamera = e.clientY - cameraY;

      cameraX = e.clientX - mouseXToCamera * scaleRatio;
      cameraY = e.clientY - mouseYToCamera * scaleRatio;
      scale = newScale;
    } else {
      // Pan Logic
      const panSpeed = 1;
      if (e.shiftKey) {
        cameraX -= (e.deltaY || e.deltaX) * panSpeed;
      } else {
        cameraX -= e.deltaX * panSpeed;
        cameraY -= e.deltaY * panSpeed;
      }
    }
    updateCanvas();
  },
  { passive: false },
);

viewport.addEventListener("mousedown", (e) => {
  if (panAnimationId) cancelAnimationFrame(panAnimationId);
  if (e.target === viewport) {
    isDragging = true;
    dragStartX = e.clientX - cameraX;
    dragStartY = e.clientY - cameraY;
  }
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  cameraX = e.clientX - dragStartX;
  cameraY = e.clientY - dragStartY;
  updateCanvas();
});

window.addEventListener("mouseup", () => {
  isDragging = false;
});

window.addEventListener("keydown", (e) => {
  // --- Intercept Modal Controls ---
  const linkModal = document.getElementById("link-modal");
  const confirmModal = document.getElementById("confirm-modal");

  // 1. Link Modal
  if (linkModal && !linkModal.classList.contains("hidden")) {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("modal-save").click();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      document.getElementById("modal-cancel").click();
    }
    return; // Stop processing other hotkeys
  }

  // 2. Confirm Modal
  if (confirmModal && !confirmModal.classList.contains("hidden")) {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("confirm-yes").click();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      document.getElementById("confirm-cancel").click();
    }
    return; // Stop processing other hotkeys
  }
  // 1. Check if the user is currently typing
  const isTyping =
    document.activeElement.tagName === "INPUT" ||
    document.activeElement.tagName === "TEXTAREA" ||
    document.activeElement.isContentEditable;

  // Works whether you are typing or just navigating!
  if (e.ctrlKey && e.key.toLowerCase() === "l") {
    e.preventDefault(); // CRITICAL: Stops the browser from focusing the URL bar
    if (activeNode) {
      const linkBtn = activeNode.element.querySelector(".node-add-link");
      if (linkBtn) linkBtn.click();
    }
    return;
  }

  // --- NEW: Tab from Title to Description ---
  if (isTyping && e.key === "Tab" && activeNode) {
    const titleEl = activeNode.element.querySelector(".node-title");
    const descEl = activeNode.element.querySelector(".node-desc");

    // If we are currently focused on the title, Tab moves to description
    if (document.activeElement === titleEl) {
      e.preventDefault(); // Stop default browser tabbing
      focusAndPlaceCursorAtEnd(descEl);
      return;
    }
  }

  // If we are currently typing in a title or description field
  if (isTyping && e.key === "Escape") {
    e.preventDefault();
    document.activeElement.blur(); // Removes focus, which triggers your save logic
    window.getSelection().removeAllRanges(); // Clears the blue text highlight
  }

  // New Task (Shift + N) ---
  if (!isTyping && e.key.toLowerCase() === "n" && e.shiftKey && activeNode) {
    e.preventDefault();

    const newBtn = document.getElementById("add-root-btn");
    if (newBtn) newBtn.click();

    return;
  }

  // If we are typing, ignore all navigation hotkeys below this line
  if (isTyping) return;

  //Enter to Edit Title (Make sure Shift is NOT pressed) ---
  if (e.key === "Enter" && !e.shiftKey && activeNode) {
    e.preventDefault();
    const titleEl = activeNode.element.querySelector(".node-title");
    focusAndPlaceCursorAtEnd(titleEl);
    return;
  }

  //Add Subtask (Shift + Enter) ---
  if (e.key === "Enter" && e.shiftKey && activeNode) {
    e.preventDefault();
    const subtaskBtn = activeNode.element.querySelector(".node-add-subtask");
    if (subtaskBtn) subtaskBtn.click();
    return;
  }

  //Toggle Complete (Spacebar) ---
  if (e.key === " " && activeNode) {
    e.preventDefault(); // CRITICAL: Stops the spacebar from scrolling the page down
    const checkbox = activeNode.element.querySelector(".node-complete-cb");
    if (checkbox) checkbox.click();
    return;
  }

  //Delete Node (Delete key) ---
  if (e.key === "Delete" && activeNode) {
    e.preventDefault();
    const deleteBtn = activeNode.element.querySelector(".node-delete");
    if (deleteBtn) deleteBtn.click(); // Naturally triggers your confirm modal!
    return;
  }

  // 3. Recenter Camera ('C' or 'Home')
  if (e.key === "c" || e.key === "C" || e.key === "Home") {
    e.preventDefault();
    recenterCamera();
    return;
  }

  // 4. Expand / Collapse ('+' or '-')
  if (activeNode) {
    // Handle + (Numpad Add, or Shift+=) and = (in case they forget Shift)
    if (e.key === "+" || e.key === "=") {
      if (!activeNode.isExpanded && activeNode.children.length > 0) {
        activeNode.isExpanded = true;
        updateTreeLayout();
        setActiveNode(activeNode); // Keep it centered after expanding
      }
      return;
    }

    // Handle - (Numpad Subtract, or standard dash)
    if (e.key === "-" || e.key === "_") {
      if (activeNode.isExpanded && activeNode.children.length > 0) {
        activeNode.isExpanded = false;
        updateTreeLayout();
        setActiveNode(activeNode); // Keep it centered after collapsing
      }
      return;
    }
  }

  // 5. Arrow Key Navigation
  if (!activeNode) {
    if (rootTasks.length > 0 && e.key.startsWith("Arrow"))
      setActiveNode(rootTasks[0]);
    return;
  }

  const siblings = activeNode.parent ? activeNode.parent.children : rootTasks;
  const currentIndex = siblings.indexOf(activeNode);

  switch (e.key) {
    case "ArrowRight":
      if (activeNode.children.length > 0) {
        if (!activeNode.isExpanded) {
          activeNode.isExpanded = true;
          updateTreeLayout();
        }
        // Because of our core fix, we can just call this immediately!
        setActiveNode(activeNode.children[0]);
      }
      break;
    case "ArrowLeft":
      if (activeNode.parent) {
        setActiveNode(activeNode.parent);
      }
      break;
    case "ArrowUp":
      if (currentIndex > 0) {
        setActiveNode(siblings[currentIndex - 1]);
      }
      break;
    case "ArrowDown":
      if (currentIndex < siblings.length - 1) {
        setActiveNode(siblings[currentIndex + 1]);
      }
      break;
  }
});

// --- Mobile Touch Controls ---
let initialPinchDistance = null;
let initialScale = 1;
let lastTouchPanX = 0;
let lastTouchPanY = 0;

// Helper to get distance between two fingers
function getDistance(touches) {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
}

// Helper to get the center point of one or two fingers
function getTouchCenter(touches) {
  if (touches.length === 1) {
    return { x: touches[0].clientX, y: touches[0].clientY };
  }
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

document.addEventListener(
  "touchstart",
  (e) => {
    // Don't pan if they are tapping a button, input, or checkbox
    if (e.target.closest("button, input, textarea")) return;

    if (e.touches.length === 1 || e.touches.length === 2) {
      const center = getTouchCenter(e.touches);
      lastTouchPanX = center.x;
      lastTouchPanY = center.y;
    }

    if (e.touches.length === 2) {
      initialPinchDistance = getDistance(e.touches);
      initialScale = scale;
    }
  },
  { passive: false },
);

document.addEventListener(
  "touchmove",
  (e) => {
    // Prevent default scrolling only if we are touching the canvas background
    if (!e.target.closest(".node-container")) {
      e.preventDefault();
    }

    // Handle Panning (1 or 2 fingers)
    if (e.touches.length === 1 || e.touches.length === 2) {
      const center = getTouchCenter(e.touches);
      const deltaX = center.x - lastTouchPanX;
      const deltaY = center.y - lastTouchPanY;

      cameraX += deltaX;
      cameraY += deltaY;

      lastTouchPanX = center.x;
      lastTouchPanY = center.y;

      updateCanvas();
    }

    // Handle Pinch to Zoom (2 fingers only)
    if (e.touches.length === 2 && initialPinchDistance) {
      const currentDistance = getDistance(e.touches);
      const pinchRatio = currentDistance / initialPinchDistance;

      // Calculate new scale and clamp it between min/max limits (e.g., 0.2x to 2x)
      let newScale = initialScale * pinchRatio;
      newScale = Math.max(0.2, Math.min(newScale, 2));

      scale = newScale;
      updateCanvas();
    }
  },
  { passive: false },
);

document.addEventListener("touchend", (e) => {
  // Reset pinch distance if a finger lifts
  if (e.touches.length < 2) {
    initialPinchDistance = null;
  }
  // If one finger remains down after a pinch, reset the pan anchor so it doesn't jump
  if (e.touches.length === 1) {
    lastTouchPanX = e.touches[0].clientX;
    lastTouchPanY = e.touches[0].clientY;
  }
});

// --- Modal Manager ---
const modal = document.getElementById("link-modal");
const modalUrl = document.getElementById("modal-url");
const modalText = document.getElementById("modal-text");
const modalCancel = document.getElementById("modal-cancel");
const modalSave = document.getElementById("modal-save");

let modalCallback = null; // Stores the function to run when "Save" is clicked

function openLinkModal(callback) {
  modalCallback = callback;
  modalUrl.value = "";
  modalText.value = "";
  modal.classList.remove("hidden");
  modalUrl.focus();
}

function closeLinkModal() {
  modal.classList.add("hidden");
  modalCallback = null;
}

modalCancel.addEventListener("click", closeLinkModal);

modalSave.addEventListener("click", () => {
  if (modalCallback && modalUrl.value) {
    modalCallback(modalUrl.value, modalText.value);
  }
  closeLinkModal();
});

// --- Confirm Modal Manager ---
const confirmModal = document.getElementById("confirm-modal");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmCancel = document.getElementById("confirm-cancel");
const confirmYes = document.getElementById("confirm-yes");

let confirmCallback = null;

function openConfirmModal(
  callback,
  message = "Are you sure?",
  title = "Confirm Action",
  buttonText = "Yes, Proceed",
) {
  confirmCallback = callback;

  // Inject the custom text into the DOM
  confirmTitle.innerText = title;
  confirmMessage.innerText = message;
  confirmYes.innerText = buttonText;

  // Change button color to red if it's a destructive action (optional but nice)
  if (
    buttonText.toLowerCase().includes("delete") ||
    buttonText.toLowerCase().includes("overwrite")
  ) {
    confirmYes.className =
      "px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors";
  } else {
    confirmYes.className =
      "px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors";
  }

  confirmModal.classList.remove("hidden");
}

function closeConfirmModal() {
  confirmModal.classList.add("hidden");
  confirmCallback = null;
}

confirmCancel.addEventListener("click", closeConfirmModal);
confirmYes.addEventListener("click", () => {
  if (confirmCallback) confirmCallback();
  closeConfirmModal();
});

// --- App State ---
const rootTasks = [];

document.getElementById("add-root-btn").addEventListener("click", () => {
  // Add new roots to the array
  const newRoot = new TodoNode("New Task", 0, 0);
  rootTasks.push(newRoot);
  DataManager.save();
  // Clean, sequential calls
  updateTreeLayout();
  setActiveNode(newRoot);

  // Focus and select the title text
  setTimeout(() => {
    const titleEl = newRoot.element.querySelector(".node-title");
    focusAndSelectAll(titleEl);
  }, 10);
});
// --- Node Class ---
class TodoNode {
  constructor(title, x, y, parent = null, savedColor = null) {
    this.id =
      "node_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
    this.title = title;
    this.description = "";
    this.dueDate = "";
    this.links = [];

    // New State Properties
    this.progress = 0;
    this.isCompleted = false;

    this.parent = parent;
    this.color = savedColor || (parent ? parent.color : getRandomColor());
    this.children = [];
    this.isExpanded = true;

    this.x = x;
    this.y = y;

    this.linksContainer = null;
    this.element = this.createDOMElement();
    this.updatePosition();

    document.getElementById("canvas").appendChild(this.element);

    // Ensure progress is calculated on creation (important for children)
    this.calculateProgress();
  }

  createDOMElement() {
    const template = document.getElementById("node-template");
    const clone = template.content.cloneNode(true);

    const div = clone.querySelector(".node-container");
    div.id = this.id;
    // 1. Make the left border thick and prominent
    // We remove the default slate border so it doesn't clash
    div.classList.remove("border-slate-600");
    div.style.border = `1px solid #475569`; // Reset thin border
    div.style.borderLeft = `8px solid ${this.color}`; // Apply thick accent border        // Checkbox Logic

    this.checkbox = div.querySelector(".node-complete-cb");
    this.checkbox.checked = this.isCompleted;
    this.checkbox.addEventListener("change", (e) =>
      this.handleCompleteToggle(e),
    );
    // Stop canvas drag when clicking checkbox
    this.checkbox.addEventListener("mousedown", (e) => e.stopPropagation());

    // Title Logic
    const titleEl = div.querySelector(".node-title");
    titleEl.innerText = this.title;
    titleEl.addEventListener("input", () => updateTreeLayout());
    titleEl.addEventListener("blur", (e) => {
      if (e.target.innerText.trim() === "") {
        e.target.innerHTML = "";
        this.title = "";
      } else {
        this.title = e.target.innerText;
      }
      DataManager.save();
    });

    // Description Logic
    const descEl = div.querySelector(".node-desc");
    descEl.innerText = this.description;
    descEl.addEventListener("input", () => updateTreeLayout());
    descEl.addEventListener("blur", (e) => {
      if (e.target.innerText.trim() === "") {
        e.target.innerHTML = "";
        this.description = "";
      } else {
        this.description = e.target.innerText;
      }
      DataManager.save();
    });

    // Date Logic
    const dateInput = div.querySelector(".node-date");
    dateInput.value = this.dueDate;
    dateInput.addEventListener("change", (e) => {
      this.dueDate = e.target.value;
      DataManager.save();
    });

    const addLinkBtn = div.querySelector(".node-add-link");
    addLinkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLinkModal((url, text) => {
        const validUrl = url.startsWith("http") ? url : `https://${url}`;
        const displayText = text.trim() || validUrl.replace(/^https?:\/\//, "");
        this.links.push({ url: validUrl, text: displayText });
        this.renderLinks();
        DataManager.save();
      });
    });

    this.linksContainer = div.querySelector(".node-links");
    this.linksContainer.addEventListener("mousedown", (e) =>
      e.stopPropagation(),
    );
    this.linksContainer.addEventListener("click", (e) => {
      const deleteBtn = e.target.closest(".link-delete-btn");
      if (deleteBtn) {
        e.stopPropagation();
        const index = parseInt(deleteBtn.dataset.index, 10);
        this.links.splice(index, 1);
        this.renderLinks();
        DataManager.save(); // <-- ADDED HERE
      }
    });
    this.progressBar = div.querySelector(".node-progress");
    this.progressText = div.querySelector(".node-progress-text"); // The percentage text

    // IMPORTANT: Remove the default Tailwind blue class first!
    this.progressBar.classList.remove("bg-blue-500");
    this.progressBar.style.backgroundColor = this.color;

    const addSubtaskBtn = div.querySelector(".node-add-subtask");
    // 3. Color the "Add Subtask" button
    // Remove default blue backgrounds
    addSubtaskBtn.classList.remove(
      "bg-blue-600",
      "hover:bg-blue-500",
      "text-white",
    );
    // Apply branch color and use dark text for contrast against pastel colors
    addSubtaskBtn.style.backgroundColor = this.color;
    addSubtaskBtn.classList.add(
      "text-slate-900",
      "font-bold",
      "hover:opacity-90",
    );
    addSubtaskBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.addChild();
    });

    // NEW: Delete Button Logic
    const deleteBtn = div.querySelector(".node-delete");
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.requestDelete();
    });
    div.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      setActiveNode(this);
    });
    //Collapse Button Logic
    this.collapseBtn = div.querySelector(".node-collapse-btn");
    this.collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.isExpanded = !this.isExpanded;
      updateTreeLayout(); // Redraw everything!
    });

    return div;
  }

  syncUI() {
    this.element.querySelector(".node-title").innerText = this.title;
    this.element.querySelector(".node-desc").innerText = this.description;
    this.element.querySelector(".node-date").value = this.dueDate;

    this.checkbox.checked = this.isCompleted;
    this.renderLinks();
    this.updateVisualStyle();
  }

  /**
   * Checks if the node is pristine/blank
   */
  requestDelete() {
    const isDefaultTitle =
      this.title === "New Subtask" ||
      this.title === "New Task" ||
      this.title.trim() === "";
    const noDescription = this.description.trim() === "";
    const noLinks = this.links.length === 0;
    const noChildren = this.children.length === 0;

    if (isDefaultTitle && noDescription && noLinks && noChildren) {
      this.removeNode(); // It's blank, just trash it
    } else {
      openConfirmModal(
        () => this.removeNode(),
        "Are you sure you want to delete this task? This will also delete all of its subtasks.",
        "Delete Task",
        "Yes, Delete",
      );
    }
  }

  /**
   * Completely removes the node from the DOM and data structure.
   */
  removeNode() {
    //Recursively delete all children first so we don't leave orphaned DOM elements!
    [...this.children].forEach((child) => child.removeNode());

    // 1. Remove from DOM
    if (activeNode === this) {
      setActiveNode(this.parent || rootTasks[0] || null);
    }
    this.element.remove();

    // 2. Remove from Data Structure
    if (this.parent) {
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
      this.parent.calculateProgress();
    } else {
      const index = rootTasks.indexOf(this);
      if (index > -1) {
        rootTasks.splice(index, 1);
      }
    }

    // 3. Re-draw the tree
    if (!this.parent || typeof updateTreeLayout === "function") {
      updateTreeLayout();
      DataManager.save();
    }
  }

  renderLinks() {
    if (!this.linksContainer) return;
    this.linksContainer.innerHTML = "";

    const template = document.getElementById("link-template");

    this.links.forEach((linkObj, index) => {
      const clone = template.content.cloneNode(true);

      // 1. Populate the Link
      const linkEl = clone.querySelector(".link-url");
      linkEl.href = linkObj.url;
      linkEl.innerText = linkObj.text;

      // 2. Tag the Delete Button with its array index
      const deleteBtn = clone.querySelector(".link-delete-btn");
      deleteBtn.dataset.index = index;

      this.linksContainer.appendChild(clone);
    });

    if (typeof updateTreeLayout === "function") updateTreeLayout();
  }

  updatePosition() {
    // NODE_WIDTH is 288. We'll assume a standard height of ~160 for the offset
    // This aligns the HTML element's center with its internal X and Y
    const offsetX = 288 / 2;
    const offsetY = (this.element.offsetHeight || 160) / 2;

    this.element.style.left = `${this.x - offsetX}px`;
    this.element.style.top = `${this.y - offsetY}px`;
  }

  addChild() {
    const newChild = new TodoNode("New Subtask", this.x, this.y, this);
    this.children.push(newChild);
    DataManager.save();
    this.calculateProgress();
    this.isExpanded = true;

    // Clean, sequential calls
    updateTreeLayout();
    setActiveNode(newChild);

    setTimeout(() => {
      const titleEl = newChild.element.querySelector(".node-title");
      focusAndSelectAll(titleEl);
    }, 10);
  }

  /**
   * Handles the user clicking the checkbox.
   */
  handleCompleteToggle(e) {
    const isChecking = e.target.checked;

    // If checking, and we have incomplete children, ask for confirmation
    if (isChecking && this.hasIncompleteChildren()) {
      e.preventDefault();
      this.checkbox.checked = false;

      openConfirmModal(
        () => {
          this.setCompleteState(true, true);
        },
        "Marking this parent task as complete will automatically complete all of its subtasks.",
        "Complete All Subtasks?",
        "Yes, Complete All",
      );
    } else {
      // Normal toggle
      this.setCompleteState(isChecking, false);
    }
  }

  hasIncompleteChildren() {
    // Returns true if ANY child has a progress less than 100
    return this.children.some((child) => child.progress < 100);
  }

  setCompleteState(isComplete, recursive) {
    this.isCompleted = isComplete;
    this.checkbox.checked = isComplete;

    if (recursive && isComplete) {
      [...this.children].forEach((child) => child.setCompleteState(true, true));
    }

    this.updateVisualStyle();
    this.calculateProgress();

    updateTreeLayout();
    DataManager.save();
  }

  /**
   * Calculates the % progress based on children, or directly from the checkbox if a leaf node.
   */
  calculateProgress() {
    if (this.children.length === 0) {
      // Leaf node: progress is either 0 or 100
      this.progress = this.isCompleted ? 100 : 0;
    } else {
      // Branch node: progress is the average of all children
      const totalProgress = this.children.reduce(
        (sum, child) => sum + child.progress,
        0,
      );
      this.progress = Math.floor(totalProgress / this.children.length);

      // Auto-update completed state if progress reaches 100 naturally
      this.isCompleted = this.progress === 100;
      this.checkbox.checked = this.isCompleted;
      this.updateVisualStyle();
    }

    // Update the UI
    this.progressBar.style.width = `${this.progress}%`;
    this.progressText.innerText = `${this.progress}%`;

    // Crucial: Tell the parent to recalculate its own progress!
    if (this.parent) {
      this.parent.calculateProgress();
    }
  }

  updateVisualStyle() {
    const classes = [
      "opacity-50",
      "grayscale",
      "hover:opacity-100",
      "hover:grayscale-0",
    ];
    // Loops through the array and adds them if isCompleted is true, removes if false
    classes.forEach((c) => this.element.classList.toggle(c, this.isCompleted));
  }
}

// --- Layout Engine ---
class TreeLayoutEngine {
  constructor() {
    // Configuration
    this.horizontalSpacing = 380;
    this.verticalGap = 30;
    this.nodeWidth = 288;
    this.svgLayer = document.getElementById("connections-layer");
  }

  calculateSubtreeHeight(node) {
    node.children.sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));
    const nodeHeight = node.element.offsetHeight || 150;

    if (node.children.length === 0 || !node.isExpanded) {
      node.subtreeHeight = nodeHeight;
      return node.subtreeHeight;
    }

    let childrenHeight = 0;
    node.children.forEach((child) => {
      childrenHeight += this.calculateSubtreeHeight(child) + this.verticalGap;
    });
    childrenHeight -= this.verticalGap;

    node.subtreeHeight = Math.max(nodeHeight, childrenHeight);
    return node.subtreeHeight;
  }

  assignPositions(node, x, centerY) {
    node.element.classList.remove("hidden");
    node.x = x;
    node.y = centerY;
    node.updatePosition();

    if (node.collapseBtn) {
      if (node.children.length > 0) {
        node.collapseBtn.classList.remove("hidden");
        node.collapseBtn.innerText = node.isExpanded ? "−" : "+";
      } else {
        node.collapseBtn.classList.add("hidden");
      }
    }

    if (node.children.length === 0 || !node.isExpanded) return;

    let currentY = centerY - node.subtreeHeight / 2;
    node.children.forEach((child) => {
      let childCenterY = currentY + child.subtreeHeight / 2;
      this.assignPositions(child, x + this.horizontalSpacing, childCenterY);
      currentY += child.subtreeHeight + this.verticalGap;
    });
  }

  drawLines(rootNodes) {
    const activePathIds = new Set();

    // Arrow function keeps 'this' bound to the class so we can access this.nodeWidth
    const drawConnection = (parent, child) => {
      const pathId = `path_${child.id}`;
      activePathIds.add(pathId);

      const startX = parent.x + this.nodeWidth / 2;
      const startY = parent.y;
      const endX = child.x - this.nodeWidth / 2;
      const endY = child.y;

      const curvature = 0.5;
      const deltaX = endX - startX;
      const pathString = `M ${startX} ${startY} C ${startX + deltaX * curvature} ${startY}, ${endX - deltaX * curvature} ${endY}, ${endX} ${endY}`;

      let path = document.getElementById(pathId);
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.id = pathId;
        path.classList.add("drawing");
        this.svgLayer.appendChild(path);
      }

      path.setAttribute("d", pathString);
      path.setAttribute("fill", "none");

      const length =
        Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)) *
        1.5;
      path.style.setProperty("--path-length", length);

      if (child.isCompleted) {
        path.setAttribute("stroke", "#475569");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("opacity", "0.4");
      } else {
        path.setAttribute("stroke", "#3b82f6");
        path.setAttribute("stroke-width", "3");
        path.setAttribute("opacity", "1");
      }

      if (child.isExpanded && child.children.length > 0) {
        child.children.forEach((grandchild) =>
          drawConnection(child, grandchild),
        );
      }
    };

    rootNodes.forEach((root) => {
      if (root.isExpanded && root.children.length > 0) {
        root.children.forEach((child) => drawConnection(root, child));
      }
    });

    Array.from(this.svgLayer.querySelectorAll("path")).forEach((path) => {
      if (!activePathIds.has(path.id)) path.remove();
    });
  }

  update(rootNodes) {
    if (rootNodes.length === 0) return;

    const allNodes = [];
    const gatherNodes = (node) => {
      allNodes.push(node);
      node.children.forEach(gatherNodes);
    };
    rootNodes.forEach(gatherNodes);

    rootNodes.sort((a, b) => a.isCompleted - b.isCompleted);
    allNodes.forEach((node) => node.element.classList.remove("hidden"));

    void document.body.offsetHeight; // Force reflow
    rootNodes.forEach((root) => this.calculateSubtreeHeight(root));

    allNodes.forEach((node) => node.element.classList.add("hidden"));

    const rootStartX = 0;
    const ROOT_GAP = 100;

    const totalForestHeight =
      rootNodes.reduce((sum, root) => sum + root.subtreeHeight, 0) +
      (rootNodes.length - 1) * ROOT_GAP;

    let currentTopY = -(totalForestHeight / 2);

    rootNodes.forEach((root) => {
      const rootCenterY = currentTopY + root.subtreeHeight / 2;
      this.assignPositions(root, rootStartX, rootCenterY);
      currentTopY += root.subtreeHeight + ROOT_GAP;
    });

    this.drawLines(rootNodes);
  }
}

// Instantiate the engine
const LayoutEngine = new TreeLayoutEngine();

let layoutFrameRequest = null;

// bridge function
function updateTreeLayout() {
  if (layoutFrameRequest) cancelAnimationFrame(layoutFrameRequest);

  layoutFrameRequest = requestAnimationFrame(() => {
    LayoutEngine.update(rootTasks);

    // Mark the layout as officially complete
    layoutFrameRequest = null;

    // If the camera was waiting for this layout, trigger the pan now!
    if (pendingCameraPan) {
      focusActiveNodeCamera();
      pendingCameraPan = false;
    }
  });
}

function downloadBackup() {
  // 1. Grab the live data directly from the array, NOT local storage.
  // This ensures you can download even if the user hasn't made a change yet.
  const data = {
    timestamp: Date.now(), // Create a fresh timestamp for the backup file
    roots: rootTasks.map((root) => DataManager.serializeNode(root)), // We will define serializeNode next
  };

  // 2. Convert to JSON and create a Blob
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  // 3. Create the temporary download link
  const a = document.createElement("a");
  a.href = url;

  // Create a clean filename like: todo-backup-2023-10-27T14-30-00.json
  const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.download = `todo-backup-${dateStr}.json`;

  // 4. Append, Click, and Cleanup (Crucial for Firefox and Safari)
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// --- Gear Menu Toggle ---
const gearBtn = document.getElementById("gear-btn");
const gearMenu = document.getElementById("gear-menu");

gearBtn.addEventListener("click", (e) => {
  e.stopPropagation(); // Prevent document click from immediately closing it
  gearMenu.classList.toggle("opacity-0");
  gearMenu.classList.toggle("scale-95");
  gearMenu.classList.toggle("pointer-events-none");
  gearBtn.classList.toggle("rotate-90");
});

// Close menu if clicking anywhere else on the canvas
document.addEventListener("click", () => {
  gearMenu.classList.add("opacity-0", "scale-95", "pointer-events-none");
  gearBtn.classList.remove("rotate-90");
});

// --- Clear List Logic ---
function confirmClearList() {
  // 1. Close the gear menu immediately so it's not hovering open behind the modal
  gearMenu.classList.add("opacity-0", "scale-95", "pointer-events-none");
  gearBtn.classList.remove("rotate-90");

  // 2. Trigger the modal
  openConfirmModal(
    () => {
      // Wipe the current canvas completely clean
      [...rootTasks].forEach((root) => root.removeNode());

      // Safety net: Destroy any lingering DOM elements
      document.querySelectorAll(".node-container").forEach((el) => el.remove());

      // Reset state arrays and layers
      rootTasks.length = 0;
      LayoutEngine.svgLayer.innerHTML = "";

      // Spawn the starting task
      spawnDefaultTask();

      // Re-center the camera
      cameraX = window.innerWidth / 2;
      cameraY = window.innerHeight / 2;
      scale = 1;
      updateCanvas();
    },
    "Are you sure you want to completely clear your board? This cannot be undone unless you have a downloaded backup.",
    "Clear Entire Board",
    "Yes, Delete Everything",
  );
}

// --- Data Persistence Engine ---
// --- Data Persistence Engine ---
class TreeDataManager {
  // We now pass the Firebase database and the room ID into the manager
  constructor(db, listId) {
    this.db = db;
    this.listId = listId;
    this.isSyncing = false; // Prevents infinite save loops
    this.isInitialLoad = true; // Tracks the first load so we don't snap the camera constantly

    // NEW: Unique ID for this specific browser tab
    this.clientId = Date.now() + "_" + Math.random().toString(36).substring(2);

    // NEW: Tracks the age of the board for backups
    this.currentBoardTimestamp = 0;
  }

  save() {
    if (this.isSyncing) return;

    const data = {
      timestamp: Date.now(),
      lastUpdatedBy: this.clientId, // <-- Stamp your ID on the save!
      roots: rootTasks.map((root) => this.serializeNode(root)),
    };

    set(ref(this.db, "lists/" + this.listId), data);
  }

  /**
   * Smartly updates the existing tree without destroying the HTML DOM.
   */
  reconcileNodes(incomingNodesData, parentNode, currentNodesArray) {
    const processedIds = new Set();
    const updatedNodesArray = [];

    incomingNodesData.forEach((dataNode) => {
      processedIds.add(dataNode.id);

      // 1. Does this node already exist on our screen?
      let existingNode = currentNodesArray.find((n) => n.id === dataNode.id);

      if (existingNode) {
        // --- UPDATE EXISTING NODE ---

        // Protection: If the user is currently typing in THIS specific node,
        // do not overwrite their text with older database data!
        const isCurrentlyTypingHere =
          activeNode === existingNode &&
          (document.activeElement.tagName === "INPUT" ||
            document.activeElement.isContentEditable);

        if (!isCurrentlyTypingHere) {
          existingNode.title = dataNode.title;
          existingNode.description = dataNode.description;
          existingNode.dueDate = dataNode.dueDate || "";
          existingNode.links = dataNode.links || [];
          existingNode.isCompleted = dataNode.isCompleted || false;
          // existingNode.isExpanded =
          //   dataNode.isExpanded !== undefined ? dataNode.isExpanded : true;
          existingNode.syncUI(); // Safely update the HTML text and colors
        }

        // Recursively check its children
        existingNode.children = this.reconcileNodes(
          dataNode.children || [],
          existingNode,
          existingNode.children,
        );
        existingNode.calculateProgress();

        updatedNodesArray.push(existingNode);
      } else {
        // --- CREATE NEW NODE ---
        // This node was added by another user, so we spawn it!
        const newNode = this.deserializeNode(dataNode, parentNode);
        updatedNodesArray.push(newNode);
      }
    });

    // --- TRASH DELETED NODES ---
    currentNodesArray.forEach((oldNode) => {
      if (!processedIds.has(oldNode.id)) {
        // It's missing from the new data, meaning another user deleted it.
        // We just remove the HTML element. The layout engine will handle the rest.
        oldNode.element.remove();
      }
    });

    return updatedNodesArray;
  }

  serializeNode(node) {
    return {
      id: node.id,
      title: node.title,
      description: node.description,
      dueDate: node.dueDate,
      links: node.links,
      isCompleted: node.isCompleted,
      isExpanded: node.isExpanded,
      color: node.color,
      children: node.children.map((child) => this.serializeNode(child)),
    };
  }

  deserializeNode(data, parent = null) {
    const node = new TodoNode(data.title, 0, 0, parent, data.color);

    // Load data
    if (data.id) node.id = data.id;
    node.description = data.description || "";
    node.dueDate = data.dueDate || "";
    node.links = data.links || [];
    node.isCompleted = data.isCompleted || false;
    node.isExpanded = data.isExpanded !== undefined ? data.isExpanded : true;

    node.syncUI();

    // Attach children recursively
    if (data.children) {
      node.children = data.children.map((childData) =>
        this.deserializeNode(childData, node),
      );
    }

    node.calculateProgress();
    return node;
  }

  loadFromData(data) {
    this.currentBoardTimestamp = data ? data.timestamp : Date.now();
    // 1. Wipe current board
    [...rootTasks].forEach((root) => root.removeNode());
    document.querySelectorAll(".node-container").forEach((el) => el.remove());
    rootTasks.length = 0;
    LayoutEngine.svgLayer.innerHTML = "";

    // 2. Rebuild from data
    if (data && data.roots && data.roots.length > 0) {
      data.roots.forEach((rootData) => {
        const rootNode = this.deserializeNode(rootData, null);
        rootTasks.push(rootNode);
      });
    } else {
      spawnDefaultTask(); // Your existing fallback for an empty list
    }

    // Clean, sequential calls
    updateTreeLayout();

    // Only recenter the camera on the very first load.
    // If we did this every time, the screen would aggressively jump
    // every time your collaboration partner clicked a checkbox!
    if (this.isInitialLoad) {
      recenterCamera();
      this.isInitialLoad = false;
    }
  }

  // NEW: This method listens to Firebase and updates the screen instantly
  initSync() {
    const listRef = ref(this.db, "lists/" + this.listId);

    onValue(listRef, (snapshot) => {
      const data = snapshot.val();
      //Spawn the default node if the database is empty ---
      if (!data) {
        if (this.isInitialLoad) {
          spawnDefaultTask();
          this.save();
          this.isInitialLoad = false;
        }
        return;
      }

      // Ignore our own saves
      if (data.lastUpdatedBy === this.clientId && !this.isInitialLoad) {
        return;
      }

      this.isSyncing = true;
      this.currentBoardTimestamp = data.timestamp;

      if (this.isInitialLoad) {
        // On the very first load, we still want to build from scratch
        this.loadFromData(data);
      } else {
        // On subsequent multiplayer updates, we do a SMART merge!
        if (data.roots) {
          const newRoots = this.reconcileNodes(data.roots, null, rootTasks);
          rootTasks.length = 0; // Empty the array
          rootTasks.push(...newRoots); // Fill it with the safely updated nodes
          updateTreeLayout(); // Redraw the connection lines smoothly
        }
      }

      setTimeout(() => {
        this.isSyncing = false;
      }, 100);
    });
  }
}

function uploadBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const uploadedData = JSON.parse(e.target.result);

      // Compare the uploaded file's timestamp to our live, in-memory timestamp
      if (
        DataManager.currentBoardTimestamp &&
        uploadedData.timestamp < DataManager.currentBoardTimestamp
      ) {
        openConfirmModal(
          () => {
            // Because they clicked "Overwrite Anyway", we force the load
            DataManager.loadFromData(uploadedData);
            DataManager.save(); // Instantly push this backup to multiplayer!
          },
          "The file you are uploading is older than your current live list. Overwriting will cause you to lose recent changes.",
          "Older Backup Detected",
          "Overwrite Anyway",
        );
        event.target.value = "";
        return;
      }

      // If no conflict (or it's newer), just load it and push to Firebase
      DataManager.loadFromData(uploadedData);
      DataManager.save();
    } catch (error) {
      console.error("Failed to parse backup:", error);
      alert("Invalid backup file.");
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

function spawnDefaultTask() {
  const initialTask = new TodoNode("Make List...", 0, 0);
  initialTask.description =
    "The first task on your to-do list should always be make list so you have something to check off.";
  initialTask.syncUI();
  rootTasks.push(initialTask);
  setActiveNode(initialTask);
}

// --- MULTIPLAYER ROOM LOGIC ---
const urlParams = new URLSearchParams(window.location.search);
let listId = urlParams.get("list");

if (!listId) {
  listId = "list_" + crypto.randomUUID();
  window.history.replaceState(null, "", `?list=${listId}`);
}

// --- INITIALIZE FIREBASE DB & SYNC ---
const DataManager = new TreeDataManager(db, listId);
DataManager.initSync();

// --- EXPOSE HTML BUTTON FUNCTIONS ---
window.confirmClearList = confirmClearList;
window.downloadBackup = downloadBackup;
window.uploadBackup = uploadBackup;
