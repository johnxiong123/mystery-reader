import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import Library from "./pages/Library.jsx";
import Reader from "./pages/Reader.jsx";

export default function App() {
  const [books, setBooks] = useState([]);
  const [activeBookId, setActiveBookId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadBooks = useCallback(async () => {
    try {
      setError("");
      const nextBooks = await api.books();
      setBooks(nextBooks);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  if (activeBookId) {
    return (
      <Reader
        bookId={activeBookId}
        onBack={() => {
          setActiveBookId(null);
          loadBooks();
        }}
      />
    );
  }

  return (
    <Library
      books={books}
      loading={loading}
      error={error}
      onRefresh={loadBooks}
      onOpenBook={setActiveBookId}
    />
  );
}
