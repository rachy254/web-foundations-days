let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

function searchNotes(word) {
  const searchTerm = word.toLowerCase();
  return notes.filter((note) => note.text.toLowerCase().includes(searchTerm));
}

function longestNote() {
  if (notes.length === 0) {
    return null;
  }

  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

function countByCategory() {
  const counts = {};
  for (const note of notes) {
    counts[note.category] = (counts[note.category] || 0) + 1;
  }
  return counts;
}

function getSummary() {
  const counts = countByCategory();
  const noteWord = notes.length === 1 ? "note" : "notes";
  return `${notes.length} ${noteWord}: ${counts.personal || 0} personal, ${counts.work || 0} work, ${counts.study || 0} study.`;
}

function isDuplicate(text) {
  const normalizedText = text.trim().toLowerCase().replace(/\s+/g, " ");
  return notes.some(
    (note) => note.text.trim().toLowerCase().replace(/\s+/g, " ") === normalizedText,
  );
}

function addNote(text, category) {
  if (typeof text !== "string") {
    console.log("Note not added: text must be a string.");
    return false;
  }

  const trimmedText = text.trim();
  if (trimmedText.length < 1 || trimmedText.length > 200) {
    console.log("Note not added: text must be 1-200 characters.");
    return false;
  }
  if (isDuplicate(trimmedText)) {
    console.log("Note not added: a note with that text already exists.");
    return false;
  }
  if (!(["personal", "work", "study"].includes(category))) {
    console.log("Note not added: category must be personal, work, or study.");
    return false;
  }

  const nextId = notes.reduce((highestId, note) => Math.max(highestId, note.id), 0) + 1;
  notes.push({ id: nextId, text: trimmedText, category });
  console.log(`Note added: "${trimmedText}" (${category}).`);
  return true;
}

console.log(searchNotes("day 3")); // Expected: [{ id: 2, text: "Finish the Day 3 assignment", category: "study" }]
console.log(searchNotes("unmatched")); // Expected: []
console.log(longestNote()); // Expected: { id: 3, text: "Email the project report to Grace", category: "work" }
console.log(countByCategory()); // Expected: { personal: 2, study: 2, work: 1 }
console.log(getSummary()); // Expected: "5 notes: 2 personal, 1 work, 2 study."
console.log(isDuplicate("  BUY   milk and bread ")); // Expected: true
console.log(isDuplicate("Buy milk")); // Expected: false

const originalNotes = notes;
notes = [];
console.log(longestNote()); // Expected: null
console.log(countByCategory()); // Expected: {}
console.log(getSummary()); // Expected: "0 notes: 0 personal, 0 work, 0 study."
notes = [{ id: 1, text: "A single note", category: "personal" }];
console.log(getSummary()); // Expected: "1 note: 1 personal, 0 work, 0 study."
notes = originalNotes;

console.log(addNote("Schedule dentist visit", "personal")); // Expected: "Note added: \"Schedule dentist visit\" (personal)." then true
console.log(addNote(" schedule   dentist visit ", "study")); // Expected: duplicate reason then false
console.log(addNote("", "work")); // Expected: length reason then false
console.log(addNote("Plan a trip", "family")); // Expected: category reason then false