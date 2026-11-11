// Walk-in residents without an email get a made-up sign-in email (app/api/residents) that nobody can sign in with, and
// accounts made by a text code have none. Such accounts sign in with a text code only, so a password does not help them.
export const placeholderEmail = (email?: string | null) => !email || /@barangaysanjose\.local$/i.test(email);
