const loadButton = document.querySelector("#load-users");
const filterInput = document.querySelector("#filter-input");
const statusMessage = document.querySelector("#status");
const usersList = document.querySelector("#users-list");

let users = [];

function renderUsers(list) {
  usersList.replaceChildren();

  for (const user of list) {
    const item = document.createElement("li");
    const name = document.createElement("h2");
    const email = document.createElement("p");
    const city = document.createElement("p");
    const company = document.createElement("p");

    name.textContent = user.name;
    email.textContent = `Email: ${user.email}`;
    city.textContent = `City: ${user.address.city}`;
    company.textContent = `Company: ${user.company.name}`;

    item.append(name, email, city, company);
    usersList.append(item);
  }
}

function filterUsers() {
  const searchTerm = filterInput.value.toLowerCase();
  const matchingUsers = users.filter((user) =>
    user.name.toLowerCase().includes(searchTerm),
  );

  renderUsers(matchingUsers);
  if (matchingUsers.length === 0) {
    statusMessage.textContent = "No users match your filter.";
  } else if (searchTerm === "") {
    const noun = users.length === 1 ? "user" : "users";
    statusMessage.textContent = `Loaded ${users.length} ${noun}.`;
  } else {
    statusMessage.textContent = `Showing ${matchingUsers.length} of ${users.length} users.`;
  }
}

async function loadUsers() {
  loadButton.disabled = true;
  statusMessage.textContent = "Loading users...";

  try {
    const response = await fetch("https://jsonplaceholder.typicode.com/users");
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    users = await response.json();
    filterUsers();
  } catch (error) {
    users = [];
    renderUsers(users);
    const detail = error instanceof Error ? ` ${error.message}` : "";
    statusMessage.textContent = `Error loading users. Please try again.${detail}`;
  } finally {
    loadButton.disabled = false;
  }
}

loadButton.addEventListener("click", loadUsers);
filterInput.addEventListener("input", filterUsers);
