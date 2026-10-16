import https from 'node:https';

// In-memory query cache with 1-hour TTL
const bookSearchCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'BookWorm-PWA/1.0' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP status ${res.statusCode}`));
      }
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Searches OpenLibrary Books API with caching and normalization
 */
export async function searchBooks(query) {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return [];
  }

  const cleanQuery = query.trim().toLowerCase();
  const cached = bookSearchCache.get(cleanQuery);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.results;
  }

  try {
    const encoded = encodeURIComponent(cleanQuery);
    const apiUrl = `https://openlibrary.org/search.json?q=${encoded}&limit=8&fields=title,author_name,cover_i,first_publish_year,subject`;

    const data = await fetchJson(apiUrl);
    const docs = Array.isArray(data.docs) ? data.docs : [];

    const results = docs.map(doc => {
      const coverId = doc.cover_i;
      const coverUrl = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
        : 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80';

      const authors = Array.isArray(doc.author_name) ? doc.author_name.join(', ') : 'Unknown Author';
      const year = doc.first_publish_year || '';

      // Map subjects to BookWorm genre
      const subjects = Array.isArray(doc.subject) ? doc.subject.join(' ').toLowerCase() : '';
      let mappedGenre = 'Fiction';
      if (/science fiction|fantasy|dune|space|magic/i.test(subjects)) mappedGenre = 'Sci-Fi & Fantasy';
      else if (/mystery|thriller|crime|detective/i.test(subjects)) mappedGenre = 'Mystery & Thriller';
      else if (/philosophy|ethics|thought/i.test(subjects)) mappedGenre = 'Philosophy';
      else if (/classic|literature|19th century/i.test(subjects)) mappedGenre = 'Classics';
      else if (/biography|memoir|autobiography/i.test(subjects)) mappedGenre = 'Biography';
      else if (/history|war|civilization/i.test(subjects)) mappedGenre = 'History';
      else if (/romance|love/i.test(subjects)) mappedGenre = 'Romance';

      return {
        title: doc.title,
        author: authors,
        coverUrl,
        genre: mappedGenre,
        year,
        bookLink: `https://openlibrary.org/search?q=${encodeURIComponent(doc.title + ' ' + authors)}`
      };
    });

    // Save in cache
    bookSearchCache.set(cleanQuery, {
      timestamp: Date.now(),
      results
    });

    // Limit cache size to 200 queries
    if (bookSearchCache.size > 200) {
      const firstKey = bookSearchCache.keys().next().value;
      bookSearchCache.delete(firstKey);
    }

    return results;
  } catch (err) {
    // Return empty on external network errors without crashing
    console.error('Book search error:', err.message);
    return [];
  }
}
