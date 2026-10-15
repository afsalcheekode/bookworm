import { isSafeUrl } from './security.js';

export const ALLOWED_GENRES = [
  'Fiction',
  'Sci-Fi & Fantasy',
  'Mystery & Thriller',
  'Non-Fiction',
  'Classics',
  'Philosophy',
  'Romance',
  'Biography',
  'Self-Help',
  'History',
  'Poetry'
];

export function validateRegister(body) {
  const errors = [];
  const { username, email, password, name } = body || {};

  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) {
    errors.push('Username must be 3-24 alphanumeric characters or underscores.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email.trim()) || email.length > 100) {
    errors.push('A valid email address is required (max 100 chars).');
  }

  if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    errors.push('Password must be between 8 and 128 characters.');
  }

  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
    errors.push('Full name must be between 2 and 60 characters.');
  }

  return { isValid: errors.length === 0, errors };
}

export function validateLogin(body) {
  const errors = [];
  const { username, password } = body || {};

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    errors.push('Username or email is required.');
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    errors.push('Password is required.');
  }

  return { isValid: errors.length === 0, errors };
}

export function validateReview(body) {
  const errors = [];
  const { bookTitle, bookAuthor, coverUrl, genre, rating, reviewText, quote, bookLink } = body || {};

  if (!bookTitle || typeof bookTitle !== 'string' || bookTitle.trim().length === 0 || bookTitle.trim().length > 200) {
    errors.push('Book title is required (max 200 characters).');
  }

  if (!bookAuthor || typeof bookAuthor !== 'string' || bookAuthor.trim().length === 0 || bookAuthor.trim().length > 150) {
    errors.push('Author name is required (max 150 characters).');
  }

  if (!coverUrl || typeof coverUrl !== 'string' || !isSafeUrl(coverUrl.trim())) {
    errors.push('A valid and safe public http(s) URL is required for the book cover image.');
  }

  if (!genre || !ALLOWED_GENRES.includes(genre)) {
    errors.push(`Invalid genre. Must be one of: ${ALLOWED_GENRES.join(', ')}`);
  }

  const numRating = parseFloat(rating);
  if (isNaN(numRating) || numRating < 0.5 || numRating > 5.0) {
    errors.push('Rating must be a number between 0.5 and 5.0.');
  }

  if (!reviewText || typeof reviewText !== 'string' || reviewText.trim().length < 10 || reviewText.trim().length > 10000) {
    errors.push('Detailed review text must be between 10 and 10,000 characters.');
  }

  if (quote && (typeof quote !== 'string' || quote.trim().length > 500)) {
    errors.push('Quote cannot exceed 500 characters.');
  }

  if (bookLink && (!isSafeUrl(bookLink.trim()) || bookLink.trim().length > 500)) {
    errors.push('Book store or info link must be a valid http(s) URL (max 500 chars).');
  }

  return { isValid: errors.length === 0, errors };
}

export function validateComment(body) {
  const errors = [];
  const { text } = body || {};

  if (!text || typeof text !== 'string' || text.trim().length === 0 || text.trim().length > 1000) {
    errors.push('Comment text is required and cannot exceed 1,000 characters.');
  }

  return { isValid: errors.length === 0, errors };
}
