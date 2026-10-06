// Нечёткий поиск: находит с опечатками, с текстом, набранным не в той раскладке
// («bdfyjd» → «иванов»), и латиницу, набранную по-русски, и наоборот («фалкон» → «Falcon»). Каждое слово запроса должно совпасть с началом какого-нибудь слова текста —
// точно или с несколькими опечатками (чем длиннее слово, тем больше опечаток допускается).

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const EN_TO_RU = Object.fromEntries([...EN].map((c, i) => [c, RU[i]]));
const RU_TO_EN = Object.fromEntries([...RU].map((c, i) => [c, EN[i]]));

const convert = (text, map) => [...text].map((c) => map[c] ?? c).join('');

// Транслитерация по звучанию — названия оружия латинские, а набирают их часто по-русски
const RU_TO_LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
// Сначала сочетания букв, потом одиночные
const LAT_TO_RU = [
  ['sch', 'щ'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['yu', 'ю'], ['ya', 'я'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'],
  ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'],
  ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['y', 'ы'], ['z', 'з'],
];
const toLatin = (text) => convert(text, RU_TO_LAT);
const toCyrillic = (text) => LAT_TO_RU.reduce((s, [lat, ru]) => s.split(lat).join(ru), text);
const normalize = (text) => String(text ?? '').toLowerCase().replace(/ё/g, 'е');
const words = (text) => normalize(text).split(/[^a-zа-я0-9]+/).filter(Boolean);

// Расстояние Левенштейна: сколько букв нужно заменить, вставить или удалить
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Сколько опечаток допускается в слове запроса такой длины
const allowedTypos = (length) => (length <= 3 ? 0 : length <= 6 ? 1 : 2);

// Насколько слово запроса похоже на слово текста: 0 — точное начало слова, больше — хуже, null — не похоже.
// Сравнивается с началом слова текста, чтобы находилось и по недописанному слову
function wordScore(queryWord, textWord) {
  if (textWord.startsWith(queryWord)) return 0;
  if (queryWord.length >= 3 && textWord.includes(queryWord)) return 0.5;
  const allowed = allowedTypos(queryWord.length);
  if (!allowed) return null;
  let best = Infinity;
  for (let len = queryWord.length - 1; len <= queryWord.length + 1; len++) {
    if (len > 0 && len <= textWord.length) best = Math.min(best, distance(queryWord, textWord.slice(0, len)));
  }
  return best <= allowed ? 1 + best : null;
}

// Оценка совпадения запроса с текстом (меньше — лучше) или null, если не совпадает
function textScore(queryWords, textWords) {
  let total = 0;
  for (const qw of queryWords) {
    let best = null;
    for (const tw of textWords) {
      const score = wordScore(qw, tw);
      if (score !== null && (best === null || score < best)) best = score;
      if (best === 0) break;
    }
    if (best === null) return null;
    total += best;
  }
  return total;
}

// Элементы списка, подходящие под запрос, — лучшие совпадения первыми.
// getText(item) — текст, по которому ищем (можно склеить несколько полей)
export function fuzzySearch(list, query, getText, limit = Infinity) {
  const q = normalize(query).trim();
  if (!q) return list.slice(0, limit);
  // Запрос как есть, в другой раскладке и в транслитерации
  const variants = [q, normalize(convert(q, EN_TO_RU)), convert(q, RU_TO_EN), toLatin(q), toCyrillic(q)].map(words);

  const found = [];
  list.forEach((item, index) => {
    const textWords = words(getText(item));
    let best = null;
    for (const queryWords of variants) {
      const score = textScore(queryWords, textWords);
      if (score !== null && (best === null || score < best)) best = score;
    }
    if (best !== null) found.push({ item, score: best, index });
  });
  return found
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((f) => f.item);
}
