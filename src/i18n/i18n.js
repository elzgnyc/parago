import { STRINGS } from './strings.js';

let current = 'en';

export function setLang(lang) {
  current = STRINGS[lang] ? lang : 'en';
}

export function getLang() {
  return current;
}

export function t(key) {
  const inCurrent = STRINGS[current] && STRINGS[current][key];
  if (inCurrent != null) return inCurrent;
  const inEn = STRINGS.en[key];
  return inEn != null ? inEn : key;
}
