// A Philippine mobile number has three spellings: 09171234567 (what people type and what profiles store),
// +639171234567 (what Supabase sign-in by text needs) and 639171234567 (how Supabase stores it). Comparing all three
// keeps one number on one account. Returns null for anything that is not a Philippine mobile number.
export function mobileForms(input: string) {
  const m = input.replace(/[\s-]/g, '').match(/^(?:\+?63|0)(9\d{9})$/);
  return m ? { local: '0' + m[1], international: '+63' + m[1], stored: '63' + m[1] } : null;
}
