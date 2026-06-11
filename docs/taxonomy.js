/* Taxonomie für die Mindmap.
   Ebene 1+2 (Gruppen + Unterkategorien) kommen aus den offiziellen
   id_stichwort-Kategorien der AWV-Suche (im Scraper getaggt, e.cats).
   Ebene 3 ("Verfeinerungen") wird hier per Titel-Keywords abgeleitet.
   Verfeinerungs-Knoten werden zwischen Kategorien geteilt – ein
   Yoga-Kurs, der unter "Gesundheit" UND "Sonstiges" hängt, verbindet
   beide Äste sichtbar miteinander. */
"use strict";

const GROUP_META = {
  bw:   { name: "Berufliche Weiterbildung",            icon: "💼", color: "#b45309" },
  gp:   { name: "Gesellschaftspolitische Weiterbildung", icon: "🏛️", color: "#c1002a" },
  ea:   { name: "Ehrenamtliche Tätigkeiten",           icon: "🤝", color: "#16a34a" },
  none: { name: "Ohne Kategorie",                      icon: "📚", color: "#64748b" },
};

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
