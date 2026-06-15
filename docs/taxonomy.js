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
  { id: "stress",      name: "Stress & Resilienz",      re: /stress|burn-?out|resilienz|entspannung|erschöpfung|work-?life(-?balance)?|\bbalance\b|ressourcen|leistungsfähigkeit|gesunderhaltung|widerstandskraft/i },
  { id: "bewegung",    name: "Bewegung & Sport",        re: /wander|pilger|nordic walking|pilates|qi ?gong|tai ?(chi|ji)|fitness|rücken|kanu|segel|kletter|surf|tanz|sportlich|feldenkrais/i },
  { id: "trainer",     name: "Übungsleiter & Trainerlizenz", re: /übungsleiter|trainer-?lizenz|trainerlizenz|\bdosb\b|breitensport|trainerausbildung|train.?the.?trainer/i },
  { id: "betrieblich", name: "Gesundheit am Arbeitsplatz", re: /arbeitsplatz|berufsalltag|betrieblich(e|es|en)? gesundheit|arbeitsschutz|ergonomie|\bbgm\b|gesund im beruf/i },
  { id: "ernaehrung",  name: "Ernährung & Fasten",      re: /ernährung|fasten|kulinari|kochen|darm/i },
  { id: "natur",       name: "Natur erleben",           re: /natur|wattenmeer|nationalpark|alpen|\bwald\b|insel|küste|\bmeer\b|vogel|kräuter|landschaft|landwirtschaft|wasser|biosphär|\bmoor\b/i },
  { id: "klima",       name: "Klima & Nachhaltigkeit",  re: /klima|nachhaltig|energiewende|ökolog|artenvielfalt|biodiversität/i },
  { id: "kommunikation", name: "Kommunikation & Rhetorik", re: /kommunikation|rhetorik|gespräch|verhandl|konflikt|moderation|präsentation|stimme|körpersprache/i },
  { id: "fuehrung",    name: "Führung & Management",    re: /führung|führen als|leadership|teamleit|\bleiten\b|management|manager/i },
  { id: "selbst",      name: "Selbst- & Zeitmanagement", re: /selbstmanagement|zeitmanagement|selbstorganisation|motivation|gewohnheit|prokrastination/i },
  { id: "persoenlichkeit", name: "Persönliche Entwicklung", re: /persönlichkeit|potenzial|selbstbewusst|selbstwert|stärken stärken|neuorientierung|lebensfreude|glück|\bsinn\b|vision|berufung|coaching/i },
  { id: "kreativ",     name: "Kreatives & Kunst",       re: /foto|schreib|malen|zeichn|kunst|theater|musik|sing|chor|\bfilm\b|kreativ|töpfer|photoshop/i },
  { id: "projekt",     name: "Projektmanagement",       re: /projektmanagement|scrum|agil/i },
  { id: "rechnungswesen", name: "Buchhaltung & Steuern", re: /buchführung|buchhaltung|bilanz|controlling|lohn|finanzbuch|steuer|entgeltabrechnung/i },
  { id: "personal",    name: "Personal & HR",           re: /personalreferent|personalfachkau|personalmanagement|personalwesen|human resources|personalentwicklung/i },
  { id: "finanzen",    name: "Finanzen & Investment",   re: /investment|\banalyst\b|\bciia\b|\bcfa\b|wertpapier|\bbörse\b|finanzanlage|vermögens/i },
  { id: "office",      name: "Office & EDV",            re: /excel|word|powerpoint|\boffice\b|\bedv\b/i },
  { id: "ki",          name: "Künstliche Intelligenz",  re: /künstliche intelligenz|\bki\b|chatgpt|\bai\b/i },
  { id: "programmierung", name: "Programmierung & Daten", re: /programmier|\bpython\b|javascript|\bcoding\b|\bsql\b|datenbank|html/i },
  { id: "web",         name: "Web & Social Media",      re: /social media|instagram|online-?marketing|website|wordpress|\bseo\b/i },
  { id: "medien",      name: "Medien & Journalismus",   re: /journalismus|journalist|\bpodcast\b|redaktion|öffentlichkeitsarbeit|pressearbeit/i },
  { id: "demenz",      name: "Demenz & Palliativ",      re: /demenz|palliativ|hospiz|sterbe/i },
  { id: "psyche",      name: "Psyche & Trauma",         re: /psych|trauma|depression|sucht/i },
  { id: "rettung",     name: "Rettung & Notfall",       re: /rettungssanitäter|rettungsdienst|notfall|erste hilfe|sanitäts|reanimation/i },
  { id: "kita",        name: "Kita & Schule",           re: /\bkita\b|kindergarten|frühpädagog|grundschul|schulkind/i },
  { id: "geschichte",  name: "Geschichte & Gedenken",   re: /geschichte|gedenkstätte|nationalsozialis|\bns-|\bddr\b|holocaust|erinner|weimar|\brömer|jüdisch|mittelalter|spuren/i },
  { id: "europa",      name: "Europa & EU",             re: /europa|europäisch|\beu\b|brüssel|straßburg|strasbourg/i },
  { id: "demokratie",  name: "Demokratie & Medien",     re: /demokratie|extremis|populis|verschwörung|fake news|medienkompetenz|desinformation/i },
  { id: "interkultur", name: "Interkulturelles",        re: /interkultur|migration|integration|flucht|geflüchtete|rassismus|diversit/i },
  { id: "arbeitsgesell", name: "Arbeitswelt & Gewerkschaft", re: /arbeitnehmer|gewerkschaft|interessenvertretung|betriebsrat|mitbestimmung|arbeitswelt|tarif|betriebliche/i },
  { id: "wirtschaftpol", name: "Wirtschaft & Globalisierung", re: /wirtschaft|globalisierung|kapitalismus|globale|lieferkette|sozialpolitik|sozialstaat/i },
  { id: "stadtregion", name: "Stadt, Region & Heimat",  re: /stadtentwicklung|kommunalpolitik|ländlicher raum|\bheimat|quartier|stadtgesellschaft|dorfentwicklung/i },
  { id: "sprachreise", name: "Sprache & Kultur vor Ort", re: /sprache (und|&) kultur|landeskunde|kulturprogramm/i },
  { id: "intensivkurs", name: "Intensiv-Sprachkurse",    re: /intensiv|sprachkurs|\bustd\b|unterrichtsstunden|lessons|\bcourses?\b|general english|niveau|\b[ab][12]\b|\bc[12]\b/i },
  { id: "aufstieg",    name: "Fachwirt, Meister & Techniker", re: /fachwirt|betriebswirt\b|industriemeister|meistervorbereitung|meisterprüfung|handwerksmeister|fachmeister|techniker|fachkaufmann|bilanzbuchhalter|elektrofachkraft/i },
  { id: "studium",     name: "Berufsbegleitendes Studium", re: /semester|bachelor|\bmaster\b|\bmba\b|fernstudi|studiengang|präsenztage|hochschulzertifikat|\(fh\)/i },
  { id: "systemisch",  name: "Systemische Beratung",     re: /systemisch/i },
  { id: "beratung",    name: "Beratung & Therapie",      re: /beratung|berater|therapie|therapeut|osteopathie|physiotherap|manuelle medizin|heilpraktik/i },
  { id: "fahrten",     name: "Politische Bildungsfahrten", re: /informationsfahrt|studienfahrt|studienreise|bildungsfahrt|exkursion|hauptstadt|\bberlin\b|brüssel|vor ort erleben/i },
  { id: "wandel",      name: "Wandel & Zukunft",         re: /wandel|zukunft|transformation|utopie|2030|2050/i },
  { id: "frauen",      name: "Frauen & Gleichstellung",  re: /frauen|gleichstellung|gender|feminis|weiblich/i },
  { id: "ruhestand",   name: "Ruhestand & Übergänge",    re: /ruhestand|\brente\b|pension|nachberuflich|lebensphase|älterwerden|dritte lebens/i },
];

function bucketize(event) {
  const hay = event.title;
  return REFINE_BUCKETS.filter((b) => b.re.test(hay)).map((b) => b.id);
}

const BUCKET_BY_ID = Object.fromEntries(REFINE_BUCKETS.map((b) => [b.id, b]));
