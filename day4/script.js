const noteText = document.querySelector("#note-text");
const charCount = document.querySelector("#char-count");
const wordCount = document.querySelector("#word-count");
const clearButton = document.querySelector("#clear-btn");
const themeToggle = document.querySelector("#theme-toggle");

const draftKey = "quicknotes-draft";
const themeKey = "quicknotes-dark-mode";

function updateCounts() {
  const text = noteText.value;
  const characterCount = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  charCount.textContent = `${characterCount} / 200 characters`;
  wordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  charCount.classList.toggle("warning", characterCount > 180 && characterCount <= 200);
  charCount.classList.toggle("over", characterCount > 200);
}

function clearNote() {
  noteText.value = "";
  localStorage.removeItem(draftKey);
  updateCounts();
}

function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
  themeToggle.setAttribute("aria-pressed", String(isDark));
}

noteText.addEventListener("input", () => {
  updateCounts();
  localStorage.setItem(draftKey, noteText.value);
});

clearButton.addEventListener("click", clearNote);

noteText.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    clearNote();
  }
});

themeToggle.addEventListener("click", () => {
  const isDark = !document.body.classList.contains("dark");
  applyTheme(isDark);
  localStorage.setItem(themeKey, String(isDark));
});

const savedDraft = localStorage.getItem(draftKey);
if (savedDraft !== null) {
  noteText.value = savedDraft;
}

applyTheme(localStorage.getItem(themeKey) === "true");
updateCounts();
