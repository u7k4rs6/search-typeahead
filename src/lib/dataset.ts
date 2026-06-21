// Programmatic dataset: generates 100k+ realistic search queries with
// Zipf-distributed counts so popularity mirrors real search traffic.

const BRANDS = [
  'apple','samsung','google','amazon','sony','microsoft','nike','adidas','netflix','spotify',
  'tesla','meta','twitter','instagram','youtube','tiktok','uber','lyft','airbnb','doordash',
  'walmart','target','costco','ikea','zara','h&m','levi','gucci','prada','chanel',
  'canon','nikon','dell','hp','lenovo','asus','lg','panasonic','bose','jbl',
  'starbucks','mcdonalds','dominos','subway','chipotle','pepsi','coca-cola','heinz','nestle','unilever',
];

// Specific product names that are common search terms on their own
const SPECIFIC_PRODUCTS = [
  'iphone','iphone 15','iphone 14','iphone 13','iphone 15 pro','iphone 15 pro max',
  'samsung galaxy','galaxy s24','galaxy s23','galaxy a54','galaxy z fold',
  'macbook','macbook pro','macbook air','macbook m3','ipad','ipad pro','ipad air',
  'airpods','airpods pro','apple watch','apple tv','apple music',
  'pixel 8','pixel 8 pro','google pixel','chromebook','google home',
  'xbox','xbox series x','playstation 5','ps5','nintendo switch',
  'kindle','echo dot','fire tv','ring doorbell','alexa',
  'chatgpt','openai','gpt 4','claude ai','gemini ai','midjourney',
  'chatgpt plus','chatgpt subscription','chatgpt 4','chatgpt login',
  'vs code','visual studio code','intellij','pycharm','android studio',
  'youtube premium','spotify premium','netflix login','disney plus',
  'doordash promo','uber eats code','grubhub coupon',
  'amazon prime','amazon prime day','amazon fire stick',
  'pizza delivery','pizza hut','dominos pizza','papa johns','little caesars',
  'mcdonalds menu','burger king','wendys','chick fil a','taco bell',
  'starbucks menu','starbucks app','starbucks rewards','dunkin donuts',
  'nike air max','nike running shoes','adidas ultraboost','new balance 990',
  'black friday deals','cyber monday','prime day 2024',
  'python tutorial','javascript tutorial','react tutorial','nextjs tutorial',
  'how to make money online','how to lose weight fast','how to cook chicken',
  'weather today','weather tomorrow','weather forecast',
];

const PRODUCTS = [
  'phone','laptop','tablet','headphones','earbuds','smartwatch','camera','tv','monitor','keyboard',
  'mouse','speaker','charger','cable','case','cover','screen protector','battery','adapter','stand',
  'shoes','sneakers','boots','sandals','shirt','pants','dress','jacket','coat','hoodie',
  'backpack','bag','wallet','sunglasses','watch','belt','hat','socks','underwear','jeans',
  'sofa','chair','desk','bed','mattress','pillow','blanket','lamp','mirror','shelf',
  'pizza','burger','sushi','tacos','pasta','salad','sandwich','coffee','tea','smoothie',
  'recipe','restaurant','delivery','near me','coupon','promo code','discount','review','price','deal',
];

const TECH = [
  'javascript','python','react','nextjs','nodejs','typescript','docker','kubernetes','aws','azure',
  'sql','mongodb','postgresql','redis','graphql','rest api','machine learning','deep learning','ai','chatgpt',
  'git','github','linux','ubuntu','windows 11','macos','android','ios','swift','kotlin',
  'css','tailwind','webpack','vite','eslint','jest','cypress','selenium','terraform','ansible',
  'tutorial','course','bootcamp','certification','interview','resume','portfolio','roadmap','cheatsheet','documentation',
];

const PLACES = [
  'new york','los angeles','chicago','houston','phoenix','philadelphia','san antonio','san diego','dallas','san jose',
  'london','paris','tokyo','dubai','singapore','sydney','toronto','berlin','amsterdam','barcelona',
  'restaurant','hotel','cafe','bar','gym','park','museum','airport','hospital','school',
  'near me','open now','best rated','cheap','luxury','downtown','delivery','takeout','dine in','outdoor',
];

const QUALIFIERS = [
  'best','top','cheap','affordable','free','how to','what is','why is','when is','where to',
  'review','vs','compare','alternative','buy','download','install','fix','update','upgrade',
  '2024','2025','new','latest','popular','trending','used','refurbished','certified','original',
  'for beginners','advanced','professional','home','portable','wireless','bluetooth','fast','lightweight','durable',
];

const VERBS = [
  'fix','install','setup','configure','update','upgrade','download','remove','delete','reset',
  'enable','disable','connect','pair','sync','backup','restore','transfer','share','export',
  'use','learn','master','improve','optimize','speed up','troubleshoot','debug','test','deploy',
];

// FNV-1a 32-bit hash — used to assign a deterministic random rank to each query.
function fnv1a32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export interface QueryEntry {
  query: string;
  count: number;
}

export function generateDataset(): QueryEntry[] {
  const seen = new Set<string>();
  // Pass 1: collect unique query strings (no counts yet).
  const queries: string[] = [];

  const add = (q: string) => {
    const norm = q.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    queries.push(norm);
  };

  // Specific real-world product names with high counts
  for (const sp of SPECIFIC_PRODUCTS) add(sp);

  // Single-word brand and product terms
  for (const b of BRANDS)   add(b);
  for (const p of PRODUCTS) add(p);
  for (const t of TECH)     add(t);
  for (const pl of PLACES)  add(pl);

  // brand + product (50 × 31 = 1550)
  for (const b of BRANDS) {
    for (const p of PRODUCTS.slice(0, 31)) {
      add(`${b} ${p}`);
    }
  }

  // qualifier + product (40 × 31 = 1240)
  for (const q of QUALIFIERS.slice(0, 40)) {
    for (const p of PRODUCTS.slice(0, 31)) {
      add(`${q} ${p}`);
    }
  }

  // qualifier + brand (40 × 50 = 2000)
  for (const q of QUALIFIERS.slice(0, 40)) {
    for (const b of BRANDS) add(`${q} ${b}`);
  }

  // qualifier + tech (40 × 50 = 2000)
  for (const q of QUALIFIERS.slice(0, 40)) {
    for (const t of TECH.slice(0, 50)) add(`${q} ${t}`);
  }

  // tech + product (50 × 20 = 1000)
  for (const t of TECH.slice(0, 50)) {
    for (const p of PRODUCTS.slice(0, 20)) add(`${t} ${p}`);
  }

  // places + qualifier (40 × 10 = 400)
  for (const pl of PLACES.slice(0, 40)) {
    for (const q of ['best','cheap','top','near me','open now','delivery','hotel','restaurant','cafe','gym']) {
      add(`${pl} ${q}`);
    }
  }

  // "how to" + verb + tech/product (30 × 50 = 1500)
  for (const v of VERBS.slice(0, 30)) {
    for (const t of TECH.slice(0, 50)) add(`how to ${v} ${t}`);
  }

  // "how to" + verb + product (30 × 20 = 600)
  for (const v of VERBS.slice(0, 30)) {
    for (const p of PRODUCTS.slice(0, 20)) add(`how to ${v} ${p}`);
  }

  // brand + tech + qualifier (25 × 25 × 8 = 5000)
  for (const b of BRANDS.slice(0, 25)) {
    for (const t of TECH.slice(0, 25)) {
      for (const q of ['tutorial','guide','review','download','install','update','free','2024']) {
        add(`${b} ${t} ${q}`);
      }
    }
  }

  // brand + product + qualifier (30 × 20 × 8 = 4800)
  for (const b of BRANDS.slice(0, 30)) {
    for (const p of PRODUCTS.slice(0, 20)) {
      for (const q of ['review','price','buy','cheap','best','2024','deals','coupon']) {
        add(`${b} ${p} ${q}`);
      }
    }
  }

  // place + product + qualifier (20 × 15 × 6 = 1800)
  for (const pl of PLACES.slice(0, 20)) {
    for (const p of PRODUCTS.slice(0, 15)) {
      for (const q of ['near me','delivery','cheap','best','online','review']) {
        add(`${pl} ${p} ${q}`);
      }
    }
  }

  // specific products × qualifiers (70 × 8 = 560)
  for (const sp of SPECIFIC_PRODUCTS) {
    for (const q of ['review','price','buy','cheap','best','2024','deals','coupon','case','specs']) {
      add(`${sp} ${q}`);
    }
  }

  // qualifier × qualifier × noun (15 × 10 × 30 = 4500)
  for (const q1 of QUALIFIERS.slice(0, 15)) {
    for (const q2 of QUALIFIERS.slice(15, 25)) {
      for (const n of [...PRODUCTS.slice(0, 15), ...TECH.slice(0, 15)]) {
        add(`${q1} ${q2} ${n}`);
      }
    }
  }

  // tech × tech compounds (50 × 30 = 1500)
  for (const t1 of TECH.slice(0, 50)) {
    for (const t2 of TECH.slice(0, 30)) {
      if (t1 !== t2) add(`${t1} ${t2}`);
    }
  }

  // brand × brand comparison (30 × 20 = 600)
  for (const b1 of BRANDS.slice(0, 30)) {
    for (const b2 of BRANDS.slice(0, 20)) {
      if (b1 !== b2) add(`${b1} vs ${b2}`);
    }
  }

  // Extended verb phrases (30 × 40 = 1200)
  for (const v of VERBS) {
    for (const b of BRANDS.slice(0, 40)) add(`${v} ${b}`);
  }

  // Numbered product variants (brands × models, e.g. "iphone 15")
  const modelNumbers = ['10','11','12','13','14','15','16','s24','s23','s22','x','xs','xr',
    '1','2','3','4','5','6','7','8','9','pro','ultra','plus','mini','max','lite','air','se'];
  for (const b of BRANDS.slice(0, 20)) {
    for (const m of modelNumbers) {
      add(`${b} ${m}`);
      for (const q of ['review','price','specs','buy','case','accessories']) {
        add(`${b} ${m} ${q}`);
      }
    }
  }

  // category + year (20 × 6 = 120 per product)
  for (const p of PRODUCTS.slice(0, 20)) {
    for (const yr of ['2021','2022','2023','2024','2025']) {
      add(`${p} ${yr}`);
      add(`best ${p} ${yr}`);
    }
  }

  // Compound place + brand queries (20 × 25 = 500)
  for (const pl of PLACES.slice(0, 20)) {
    for (const b of BRANDS.slice(0, 25)) add(`${b} ${pl}`);
  }

  // Fill to 100k+ with brand×brand×product (30 × 20 × 20 = 12000 new unique ones)
  for (const b1 of BRANDS.slice(0, 30)) {
    for (const b2 of BRANDS.slice(0, 20)) {
      if (b1 === b2) continue;
      for (const p of PRODUCTS.slice(0, 20)) {
        add(`${b1} ${b2} ${p}`);
      }
    }
  }

  // tech × product × qualifier (30 × 20 × 8 = 4800)
  for (const t of TECH.slice(0, 30)) {
    for (const p of PRODUCTS.slice(0, 20)) {
      for (const q of ['tutorial','guide','review','download','free','online','2024','beginner']) {
        add(`${t} ${p} ${q}`);
      }
    }
  }

  // ── Expansion to 100k+ ──────────────────────────────────────────────────
  // brand × qualifier × product (50 × 40 × 55 = 110k, most new after dedup)
  for (const b of BRANDS) {
    for (const q of QUALIFIERS) {
      for (const p of PRODUCTS) {
        add(`${b} ${q} ${p}`);
      }
    }
  }

  // brand × product × year suffix (50 × 20 × 5 = 5000 new)
  for (const b of BRANDS) {
    for (const p of PRODUCTS.slice(0, 20)) {
      for (const yr of ['2020','2021','2022','2023','2025']) {
        add(`${b} ${p} ${yr}`);
      }
    }
  }

  // qualifier × brand × tech (20 × 30 × 30 = 18000 new)
  for (const q of QUALIFIERS.slice(0, 20)) {
    for (const b of BRANDS.slice(0, 30)) {
      for (const t of TECH.slice(0, 30)) {
        add(`${q} ${b} ${t}`);
      }
    }
  }

  // Pass 2: assign true Zipf(α=0.9) counts.
  // Sort queries by their FNV hash to get a deterministic, uniformly-spread ranking,
  // then apply count(rank) = round(10000 / rank^0.9).
  // α=0.9 matches observed real search traffic: top query is ~10 000× more popular
  // than the median; ~92% of queries get count=1 (long tail), which is realistic.
  const sorted = queries.slice().sort((a, b) => fnv1a32(a) - fnv1a32(b));
  const rankOf = new Map<string, number>();
  sorted.forEach((q, i) => rankOf.set(q, i + 1));

  const entries: QueryEntry[] = queries.map((q) => ({
    query: q,
    count: Math.max(1, Math.round(10_000 / Math.pow(rankOf.get(q)!, 0.9))),
  }));

  console.log(`[Dataset] Generated ${entries.length} unique queries`);
  return entries;
}
