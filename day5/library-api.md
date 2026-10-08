# Library Books API

Base URL: `/api`

The API uses JSON request and response bodies.

## Endpoints

- **List books**
  - Method: `GET`
  - Path: `/api/books`
  - Description: Returns all books in the library.
  - Success: `200 OK`

- **Get one book**
  - Method: `GET`
  - Path: `/api/books/{id}`
  - Description: Returns the book with the specified ID.
  - Success: `200 OK`

- **Create a book**
  - Method: `POST`
  - Path: `/api/books`
  - Description: Adds a book to the library.
  - Example request body:
    ```json
    {
      "title": "The Left Hand of Darkness",
      "author": "Ursula K. Le Guin",
      "publishedYear": 1969
    }
    ```
  - Success: `201 Created`

- **Update a book**
  - Method: `PUT`
  - Path: `/api/books/{id}`
  - Description: Replaces the details of the book with the specified ID.
  - Example request body:
    ```json
    {
      "title": "The Left Hand of Darkness",
      "author": "Ursula K. Le Guin",
      "publishedYear": 1969
    }
    ```
  - Success: `200 OK`

- **Delete a book**
  - Method: `DELETE`
  - Path: `/api/books/{id}`
  - Description: Removes the book with the specified ID.
  - Success: `204 No Content`

- **List books by author**
  - Method: `GET`
  - Path: `/api/books?author={author}`
  - Description: Returns books whose author matches the `author` query parameter.
  - Example request: `GET /api/books?author=Ursula%20K.%20Le%20Guin`
  - Success: `200 OK`

## Error responses

- `400 Bad Request`: The request body is invalid, such as creating a book without a title.
- `404 Not Found`: The requested book ID does not exist, such as `GET /api/books/9999`.
