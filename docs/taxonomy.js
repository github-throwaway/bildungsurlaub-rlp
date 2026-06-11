/* Taxonomie für Mindmap und Kategorie-Filter.
   Die 43 offiziellen id_stichwort-Unterkategorien der AWV-Suche (im
   Scraper getaggt, e.cats) werden hier zu nutzerfreundlichen Themen-
   Gruppen gebündelt (z. B. alle Sprachen zusammen). Die dritte Ebene
   der Mindmap ("Verfeinerungen") wird per Titel-Keywords abgeleitet. */
"use strict";

/* Thematische Gruppen über den offiziellen Kategorien */
const CAT_GROUPS = {
  sprachen: {
    name: "Sprachen", icon: "🗣️", color: "#2563eb",
    cats: ["19", "20", "22", "21", "23", "18"],
  },
  gesundheit: {
    name: "Gesundheit & Achtsamkeit", icon: "🧘", color: "#16a34a",
    cats: ["48"],
  },
  beruf: {
    name: "Beruf & Karriere", icon: "💼", color: "#b45309",
    cats: ["24", "13", "14", "15", "12", "49", "16", "51", "25"],
  },
  digital: {
    name: "IT & Digitales", icon: "💻", color: "#0891b2",
    cats: ["17", "52"],
  },
  politik: {
    name: "Politik & Gesellschaft", icon: "🏛️", color: "#c1002a",
    cats: ["38", "26", "27", "35", "47", "33", "30", "31", "34", "39", "41", "28", "46"],
  },
  umwelt: {
    name: "Umwelt & Natur", icon: "🌿", color: "#4d7c0f",
    cats: ["36", "50"],
  },
  kultur: {
    name: "Kultur & Bildung", icon: "🎨", color: "#9333ea",
    cats: ["37"],
  },
  ehrenamt: {
    name: "Ehrenamt", icon: "🤝", color: "#db2777",
    cats: ["53", "54", "55", "56", "57", "58", "59", "60", "61"],
  },
};

const GROUP_OF_CAT = {};
for (const [gid, g] of Object.entries(CAT_GROUPS)) {
  for (const cid of g.cats) GROUP_OF_CAT[cid] = gid;
}

/* Eigene Verfeinerungs-Ebene: Keyword-Buckets über den Titel */
const REFINE_BUCKETS = [
  { id: "yoga",        name: "Yoga",                    re: /yoga/i },
  { id: "achtsamkeit", name: "Achtsamkeit & Meditation", re: /achtsam|meditation|mbsr|\bzen\b|stille|innehalten/i },
  { id: "stress",      name: "Stress & Resilienz",      re: /stress|burn-?out|resilienz|entspannung|erschöpfung|work-?life(-?balance)?/i },
  { id: "bewegung",    name: "Bewegung & Sport",        re: /wander|pilger|nordic walking|pilates|qi ?gong|tai ?(chi|ji)|fitness|rücken|kanu|segel|kletter|surf|tanz|sportlich/i },
  { id: "ernaehrung",  name: "Ernährung & Fasten",      re: /ernährung|fasten|kulinari|kochen|darm/i },
  { id: "natur",       name: "Natur erleben",           re: /natur|wattenmeer|nationalpark|alpen|\bwald\b|insel|küste|\bmeer\b|vogel|kräuter|landschaft/i },
  { id: "klima",       name: "Klima & Nachhaltigkeit",  re: /klima|nachhaltig|energiewende|ökolog|artenvielfalt|biodiversität/i },
  { id: "kommunikation", name: "Kommunikation & Rhetorik", re: /kommunikation|rhetorik|gespräch|verhandl|konflikt|moderation|präsentation|stimme|körpersprache/i },
  { id: "fuehrung",    name: "Führung & Leadership",    re: /führung|führen als|leadership|teamleit|\bleiten\b/i },
  { id: "selbst",      name: "Selbst- & Zeitmanagement", re: /selbstmanagement|zeitmanagement|selbstorganisation|motivation|gewohnheit|prokrastination/i },
  { id: "persoenlichkeit", name: "Persönliche Entwicklung", re: /persönlichkeit|potenzial|selbstbewusst|selbstwert|stärken stärken|neuorientierung|lebensfreude|glück|\bsinn\b|vision|berufung|coaching/i },
  { id: "kreativ",     name: "Kreatives & Kunst",       re: /foto|schreib|malen|zeichn|kunst|theater|musik|sing|chor|\bfilm\b|kreativ|töpfer/i },
  { id: "projekt",     name: "Projektmanagement",       re: /projektmanagement|scrum|agil/i },
  { id: "rechnungswesen", name: "Buchhaltung & Finanzen", re: /buchführung|buchhaltung|bilanz|controlling|lohn|finanzbuch|steuer/i },
  { id: "office",      name: "Office & EDV",            re: /excel|word|powerpoint|\boffice\b|\bedv\b/i },
  { id: "ki",          name: "Künstliche Intelligenz",  re: /künstliche intelligenz|\bki\b|chatgpt|\bai\b/i },
  { id: "web",         name: "Web & Social Media",      re: /social media|instagram|online-?marketing|website|wordpress|\bseo\b/i },
  { id: "demenz",      name: "Demenz & Palliativ",      re: /demenz|palliativ|hospiz|sterbe/i },
  { id: "psyche",      name: "Psyche & Trauma",         re: /psych|trauma|depression|sucht/i },
  { id: "kita",        name: "Kita & Schule",           re: /\bkita\b|kindergarten|frühpädagog|grundschul|schulkind/i },
  { id: "geschichte",  name: "Geschichte & Gedenken",   re: /geschichte|gedenkstätte|nationalsozialis|\bns-|\bddr\b|holocaust|erinnerung|weimar/i },
  { id: "europa",      name: "Europa & EU",             re: /europa|europäisch|\beu\b|brüssel|straßburg|strasbourg/i },
  { id: "demokratie",  name: "Demokratie & Medien",     re: /demokratie|extremis|populis|verschwörung|fake news|medienkompetenz|desinformation/i },
  { id: "interkultur", name: "Interkulturelles",        re: /interkultur|migration|integration|flucht|geflüchtete|rassismus|diversit/i },
  { id: "sprachreise", name: "Sprache & Kultur vor Ort", re: /sprachkurs|intensivkurs|sprache (und|&) kultur|landeskunde/i },
];

function bucketize(event) {
  const hay = event.title;
  return REFINE_BUCKETS.filter((b) => b.re.test(hay)).map((b) => b.id);
}

const BUCKET_BY_ID = Object.fromEntries(REFINE_BUCKETS.map((b) => [b.id, b]));
