/**
 * Albadi factory colour catalogue — measured from the four MATERIAL COLOR PDFs
 * in the Feishu folder RSvLfcR4ull7BudymWQcWPfYnpg (Aug 2026).
 *
 * Every hex here was sampled from a large fabric area next to the swatch label,
 * then white-balance corrected against the paper visible in the same photo, and
 * compared across catalogues with CIEDE2000. They are PHOTO measurements, not
 * spectrophotometer readings — good enough to build the shortlist, not good
 * enough to commit to a customer. Confirm with a physical swatch first.
 *
 * ⚠️ NOT the same thing as BAG_COLORS in lib/constants/bagColors.ts — that one
 * drives the 3D configurator render. This one is what you order from a factory.
 *
 * Pure data + lookup helpers. NO env vars, NO server imports — safe to import
 * from a "use client" component (see the client-bundle rule in CLAUDE.md).
 *
 * Regenerating: the source JSON lives next to the PDFs at
 * content/albadi/color-catalogs/out/{MASTER,FACTORY3_CLEAN}.json.
 */

export type FactoryId = "CHEN" | "WEIWEI" | "MANDY";

/** One colour as a single factory sells it. `code` is what you put on the order. */
export interface FactoryColor {
  code: string;
  hex: string;
  /** Which MATERIAL COLOR PDF the code belongs to — MANDY carries two. */
  catalog: string;
}

/** A colour all three factories can make, with the code to ask each one for. */
export interface SharedColor {
  hex: string;
  nameHe: string;
  codes: Record<FactoryId, string>;
  /** Which MANDY catalogue its code comes from. */
  mandyCatalog: string;
  /** The weakest link: the largest CIEDE2000 gap between the three. */
  maxDeltaE: number;
  /** exact ≤ 5 — hard to tell apart even side by side. close 5–8. */
  tier: "exact" | "close";
}

export interface FactoryMeta {
  label: string;
  /**
   * The company as the quotes sheet writes it (column S, 供应商). Confirmed by
   * Simon 2026-08-27 — the catalogue names are the contacts, not the firms.
   */
  chineseName?: string;
  /** When this factory is the one you order from. */
  whenToUse: string;
  /** The short version, for a chip. */
  whenToUseShort: string;
  catalogs: string[];
}

/**
 * Which factory serves which bag, from the Feishu sheet
 * "Classification of non-woven bag material selection".
 * CHEN is the only one that covers every cell of that matrix.
 */
export const FACTORIES: Record<FactoryId, FactoryMeta> = {
  CHEN: {
    label: "CHEN",
    chineseName: "浙江鼎驰新材料科技有限公司",
    whenToUse:
      "מתאים לכל סוגי התיקים — ריתוך חם ותפירה ידנית, שטוח ותלת־ממדי. המפעל היחיד שמכסה הכול, ולכן הקטלוג שלו הוא ברירת המחדל הבטוחה.",
    whenToUseShort: "כל סוגי התיקים",
    catalogs: ["MATERIAL COLOR 2"],
  },
  WEIWEI: {
    label: "WEIWEI",
    chineseName: "温州亚森制袋",
    whenToUse:
      "תפירה ידנית — שטוח וגם תלת־ממדי — וריתוך חם שטוח. לא זמין לריתוך חם תלת־ממדי, אז שקית מולחמת עם גוסט לא תיוצר כאן.",
    whenToUseShort: "תפירה, וריתוך שטוח",
    catalogs: ["MATERIAL COLOR 1"],
  },
  MANDY: {
    label: "MANDY",
    chineseName: "浙江华庆塑业有限公司",
    whenToUse:
      "ריתוך חם תלת־ממדי בלבד — שקית מולחמת עם גוסט. מחזיק שני קטלוגי בד, אז יש כאן הכי הרבה גוונים, אבל רק לסוג התיק הזה.",
    whenToUseShort: "ריתוך תלת־ממדי בלבד",
    catalogs: ["MATERIAL COLOR 3", "MATERIAL COLOR 4"],
  },
};

/** Display order of the factories: widest coverage first. */
export const FACTORY_ORDER: FactoryId[] = ["CHEN", "WEIWEI", "MANDY"];

/**
 * The catalogue. 14 colours every factory can make, so they can be promised to
 * a customer before anyone knows where the order will land.
 */
export const SHARED_COLORS: SharedColor[] = [
  {
    hex: "#AA060D",
    nameHe: "אדום",
    codes: { CHEN: "R01", WEIWEI: "R18", MANDY: "R1195A" },
    mandyCatalog: "MATERIAL COLOR 3",
    maxDeltaE: 5.2,
    tier: "close",
  },
  {
    hex: "#AD2538",
    nameHe: "אדום־בורדו",
    codes: { CHEN: "R05", WEIWEI: "R18", MANDY: "R666A" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 7.9,
    tier: "close",
  },
  {
    hex: "#D34E1D",
    nameHe: "כתום",
    codes: { CHEN: "Y23", WEIWEI: "Y29", MANDY: "Y195A" },
    mandyCatalog: "MATERIAL COLOR 3",
    maxDeltaE: 6.8,
    tier: "close",
  },
  {
    hex: "#C2641A",
    nameHe: "כתום־אדמה",
    codes: { CHEN: "Y21", WEIWEI: "Y259", MANDY: "N228" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 5.2,
    tier: "close",
  },
  {
    hex: "#CD9826",
    nameHe: "צהוב־חרדל",
    codes: { CHEN: "Y20", WEIWEI: "Y23", MANDY: "Y778" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 2.6,
    tier: "exact",
  },
  {
    hex: "#AC9F81",
    nameHe: "חול",
    codes: { CHEN: "Y24", WEIWEI: "Y302", MANDY: "W886" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 5.6,
    tier: "close",
  },
  {
    hex: "#B0AE9D",
    nameHe: "בז׳ בהיר",
    codes: { CHEN: "W80", WEIWEI: "E05", MANDY: "W886" },
    mandyCatalog: "MATERIAL COLOR 3",
    maxDeltaE: 7.2,
    tier: "close",
  },
  {
    hex: "#298425",
    nameHe: "ירוק",
    codes: { CHEN: "G41", WEIWEI: "G68", MANDY: "B443" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 4.6,
    tier: "exact",
  },
  {
    hex: "#046E4B",
    nameHe: "ירוק כהה",
    codes: { CHEN: "G43", WEIWEI: "G63", MANDY: "G447" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 7.6,
    tier: "close",
  },
  {
    hex: "#076390",
    nameHe: "כחול־תכלת",
    codes: { CHEN: "B52", WEIWEI: "B58", MANDY: "B38" },
    mandyCatalog: "MATERIAL COLOR 3",
    maxDeltaE: 7.2,
    tier: "close",
  },
  {
    hex: "#27447B",
    nameHe: "כחול רויאל",
    codes: { CHEN: "B53", WEIWEI: "B59", MANDY: "B59" },
    mandyCatalog: "MATERIAL COLOR 3",
    maxDeltaE: 2.8,
    tier: "exact",
  },
  {
    hex: "#7C69A3",
    nameHe: "סגול־לבנדר",
    codes: { CHEN: "P60", WEIWEI: "P016", MANDY: "P117" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 7.9,
    tier: "close",
  },
  {
    hex: "#7D8077",
    nameHe: "אפור",
    codes: { CHEN: "E71", WEIWEI: "E06", MANDY: "E336" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 4.4,
    tier: "exact",
  },
  {
    hex: "#434345",
    nameHe: "שחור־פחם",
    codes: { CHEN: "C90", WEIWEI: "E08", MANDY: "C001" },
    mandyCatalog: "MATERIAL COLOR 4",
    maxDeltaE: 6.5,
    tier: "close",
  },
];

/** Every measured colour, grouped by the factory that sells it. */
export const FACTORY_COLORS: Record<FactoryId, FactoryColor[]> = {
  CHEN: [
    { code: "R01", hex: "#AA060D", catalog: "MATERIAL COLOR 2" },
    { code: "R05", hex: "#AD2538", catalog: "MATERIAL COLOR 2" },
    { code: "R06", hex: "#B22E3F", catalog: "MATERIAL COLOR 2" },
    { code: "R08", hex: "#D31B57", catalog: "MATERIAL COLOR 2" },
    { code: "R10", hex: "#DA446F", catalog: "MATERIAL COLOR 2" },
    { code: "R11A", hex: "#CB4E79", catalog: "MATERIAL COLOR 2" },
    { code: "RC238", hex: "#D02E56", catalog: "MATERIAL COLOR 2" },
    { code: "Y20", hex: "#CD9826", catalog: "MATERIAL COLOR 2" },
    { code: "Y21", hex: "#C2641A", catalog: "MATERIAL COLOR 2" },
    { code: "Y22", hex: "#DC5017", catalog: "MATERIAL COLOR 2" },
    { code: "Y23", hex: "#D34E1D", catalog: "MATERIAL COLOR 2" },
    { code: "Y24", hex: "#AC9F81", catalog: "MATERIAL COLOR 2" },
    { code: "Y28", hex: "#705837", catalog: "MATERIAL COLOR 2" },
    { code: "Y30", hex: "#4B3B36", catalog: "MATERIAL COLOR 2" },
    { code: "Y0157", hex: "#D3662C", catalog: "MATERIAL COLOR 2" },
    { code: "G40", hex: "#67A621", catalog: "MATERIAL COLOR 2" },
    { code: "G41", hex: "#298425", catalog: "MATERIAL COLOR 2" },
    { code: "G43", hex: "#046E4B", catalog: "MATERIAL COLOR 2" },
    { code: "G45", hex: "#22534A", catalog: "MATERIAL COLOR 2" },
    { code: "B50", hex: "#378FA5", catalog: "MATERIAL COLOR 2" },
    { code: "B52", hex: "#076390", catalog: "MATERIAL COLOR 2" },
    { code: "B53", hex: "#27447B", catalog: "MATERIAL COLOR 2" },
    { code: "B54", hex: "#40465B", catalog: "MATERIAL COLOR 2" },
    { code: "B55", hex: "#3D435D", catalog: "MATERIAL COLOR 2" },
    { code: "P60", hex: "#7C69A3", catalog: "MATERIAL COLOR 2" },
    { code: "P61", hex: "#713973", catalog: "MATERIAL COLOR 2" },
    { code: "P62", hex: "#4C397D", catalog: "MATERIAL COLOR 2" },
    { code: "E70", hex: "#84897C", catalog: "MATERIAL COLOR 2" },
    { code: "E71", hex: "#7D8077", catalog: "MATERIAL COLOR 2" },
    { code: "E72", hex: "#63605D", catalog: "MATERIAL COLOR 2" },
    { code: "W80", hex: "#B0AE9D", catalog: "MATERIAL COLOR 2" },
    { code: "C90", hex: "#434345", catalog: "MATERIAL COLOR 2" },
  ],
  WEIWEI: [
    { code: "R18", hex: "#AF221D", catalog: "MATERIAL COLOR 1" },
    { code: "R152", hex: "#792726", catalog: "MATERIAL COLOR 1" },
    { code: "R106", hex: "#6A212D", catalog: "MATERIAL COLOR 1" },
    { code: "R112", hex: "#391113", catalog: "MATERIAL COLOR 1" },
    { code: "R16", hex: "#CA88A3", catalog: "MATERIAL COLOR 1" },
    { code: "R129", hex: "#A2516D", catalog: "MATERIAL COLOR 1" },
    { code: "R11", hex: "#701333", catalog: "MATERIAL COLOR 1" },
    { code: "Y218", hex: "#B0A87B", catalog: "MATERIAL COLOR 1" },
    { code: "Y302", hex: "#A18F6A", catalog: "MATERIAL COLOR 1" },
    { code: "Y209", hex: "#847455", catalog: "MATERIAL COLOR 1" },
    { code: "P016", hex: "#66548F", catalog: "MATERIAL COLOR 1" },
    { code: "P01", hex: "#362056", catalog: "MATERIAL COLOR 1" },
    { code: "P02", hex: "#3D1538", catalog: "MATERIAL COLOR 1" },
    { code: "N811", hex: "#968351", catalog: "MATERIAL COLOR 1" },
    { code: "N822", hex: "#725F2F", catalog: "MATERIAL COLOR 1" },
    { code: "N899", hex: "#261911", catalog: "MATERIAL COLOR 1" },
    { code: "E05", hex: "#959A8C", catalog: "MATERIAL COLOR 1" },
    { code: "E06", hex: "#74756A", catalog: "MATERIAL COLOR 1" },
    { code: "E08", hex: "#353431", catalog: "MATERIAL COLOR 1" },
    { code: "W001", hex: "#999187", catalog: "MATERIAL COLOR 1" },
    { code: "C07", hex: "#11110D", catalog: "MATERIAL COLOR 1" },
    { code: "Y22", hex: "#D8AE14", catalog: "MATERIAL COLOR 1" },
    { code: "Y23", hex: "#CF9E1C", catalog: "MATERIAL COLOR 1" },
    { code: "Y25", hex: "#C47F1E", catalog: "MATERIAL COLOR 1" },
    { code: "Y259", hex: "#BC641E", catalog: "MATERIAL COLOR 1" },
    { code: "Y29", hex: "#B6551C", catalog: "MATERIAL COLOR 1" },
    { code: "G663", hex: "#39922A", catalog: "MATERIAL COLOR 1" },
    { code: "G68", hex: "#2A7A2E", catalog: "MATERIAL COLOR 1" },
    { code: "G63", hex: "#186B31", catalog: "MATERIAL COLOR 1" },
    { code: "G67", hex: "#0C5532", catalog: "MATERIAL COLOR 1" },
    { code: "G66", hex: "#0D5033", catalog: "MATERIAL COLOR 1" },
    { code: "G661", hex: "#06748B", catalog: "MATERIAL COLOR 1" },
    { code: "B56", hex: "#3779AD", catalog: "MATERIAL COLOR 1" },
    { code: "B58", hex: "#205693", catalog: "MATERIAL COLOR 1" },
    { code: "B577", hex: "#164E8D", catalog: "MATERIAL COLOR 1" },
    { code: "B59", hex: "#193C72", catalog: "MATERIAL COLOR 1" },
    { code: "B55", hex: "#1C1F4C", catalog: "MATERIAL COLOR 1" },
  ],
  MANDY: [
    { code: "R08", hex: "#C50919", catalog: "MATERIAL COLOR 3" },
    { code: "R1195A", hex: "#AC0C23", catalog: "MATERIAL COLOR 3" },
    { code: "R36", hex: "#961830", catalog: "MATERIAL COLOR 3" },
    { code: "R667", hex: "#A31A29", catalog: "MATERIAL COLOR 3" },
    { code: "R109", hex: "#CB6A8A", catalog: "MATERIAL COLOR 3" },
    { code: "V51049", hex: "#BA5E8B", catalog: "MATERIAL COLOR 3" },
    { code: "R322", hex: "#C63B69", catalog: "MATERIAL COLOR 3" },
    { code: "R41", hex: "#C91653", catalog: "MATERIAL COLOR 3" },
    { code: "R12519", hex: "#DB7861", catalog: "MATERIAL COLOR 3" },
    { code: "Y98", hex: "#DD8118", catalog: "MATERIAL COLOR 3" },
    { code: "Y791", hex: "#E0940B", catalog: "MATERIAL COLOR 3" },
    { code: "Y07", hex: "#D59614", catalog: "MATERIAL COLOR 3" },
    { code: "Y0157", hex: "#DD5C18", catalog: "MATERIAL COLOR 3" },
    { code: "Y195A", hex: "#D65016", catalog: "MATERIAL COLOR 3" },
    { code: "Y21618", hex: "#95A414", catalog: "MATERIAL COLOR 3" },
    { code: "G066B", hex: "#539C13", catalog: "MATERIAL COLOR 3" },
    { code: "G78", hex: "#2B9717", catalog: "MATERIAL COLOR 3" },
    { code: "G70", hex: "#048A4B", catalog: "MATERIAL COLOR 3" },
    { code: "G02", hex: "#07876A", catalog: "MATERIAL COLOR 3" },
    { code: "G61629", hex: "#858962", catalog: "MATERIAL COLOR 3" },
    { code: "G61691", hex: "#647251", catalog: "MATERIAL COLOR 3" },
    { code: "G61543", hex: "#4F7E76", catalog: "MATERIAL COLOR 3" },
    { code: "G279", hex: "#366761", catalog: "MATERIAL COLOR 3" },
    { code: "G61558", hex: "#08968D", catalog: "MATERIAL COLOR 3" },
    { code: "G61720", hex: "#239695", catalog: "MATERIAL COLOR 3" },
    { code: "G817", hex: "#329295", catalog: "MATERIAL COLOR 3" },
    { code: "B831", hex: "#047B8F", catalog: "MATERIAL COLOR 3" },
    { code: "B455", hex: "#288C9E", catalog: "MATERIAL COLOR 3" },
    { code: "B136A", hex: "#1C7C99", catalog: "MATERIAL COLOR 3" },
    { code: "B38", hex: "#066095", catalog: "MATERIAL COLOR 3" },
    { code: "B537", hex: "#035090", catalog: "MATERIAL COLOR 3" },
    { code: "B59", hex: "#1E4082", catalog: "MATERIAL COLOR 3" },
    { code: "B154A", hex: "#45476D", catalog: "MATERIAL COLOR 3" },
    { code: "B01", hex: "#484D69", catalog: "MATERIAL COLOR 3" },
    { code: "P01", hex: "#5A3D9D", catalog: "MATERIAL COLOR 3" },
    { code: "P117", hex: "#6E5D90", catalog: "MATERIAL COLOR 3" },
    { code: "N228", hex: "#AA6930", catalog: "MATERIAL COLOR 3" },
    { code: "N26", hex: "#99784A", catalog: "MATERIAL COLOR 3" },
    { code: "Y81967", hex: "#9E7549", catalog: "MATERIAL COLOR 3" },
    { code: "W885", hex: "#A58456", catalog: "MATERIAL COLOR 3" },
    { code: "Y02", hex: "#B4A170", catalog: "MATERIAL COLOR 3" },
    { code: "Y206", hex: "#B4A16A", catalog: "MATERIAL COLOR 3" },
    { code: "W886", hex: "#B6AD90", catalog: "MATERIAL COLOR 3" },
    { code: "增白 (opt.white)", hex: "#A0A5A8", catalog: "MATERIAL COLOR 3" },
    { code: "消光白 (matte white)", hex: "#9BA097", catalog: "MATERIAL COLOR 3" },
    { code: "E90740", hex: "#697F73", catalog: "MATERIAL COLOR 3" },
    { code: "E06", hex: "#6E746F", catalog: "MATERIAL COLOR 3" },
    { code: "E18", hex: "#696C6E", catalog: "MATERIAL COLOR 3" },
    { code: "N34", hex: "#6E605E", catalog: "MATERIAL COLOR 3" },
    { code: "黑新料 (black)", hex: "#56585A", catalog: "MATERIAL COLOR 3" },
    { code: "R608", hex: "#D40310", catalog: "MATERIAL COLOR 4" },
    { code: "R668", hex: "#B50A2D", catalog: "MATERIAL COLOR 4" },
    { code: "R667", hex: "#941F2B", catalog: "MATERIAL COLOR 4" },
    { code: "R666A", hex: "#A5303D", catalog: "MATERIAL COLOR 4" },
    { code: "R665", hex: "#983F52", catalog: "MATERIAL COLOR 4" },
    { code: "R666", hex: "#AC2A4C", catalog: "MATERIAL COLOR 4" },
    { code: "R664", hex: "#A23459", catalog: "MATERIAL COLOR 4" },
    { code: "R608/1252G", hex: "#C36666", catalog: "MATERIAL COLOR 4" },
    { code: "R663", hex: "#D37B8A", catalog: "MATERIAL COLOR 4" },
    { code: "R662", hex: "#CD607C", catalog: "MATERIAL COLOR 4" },
    { code: "R660", hex: "#D23060", catalog: "MATERIAL COLOR 4" },
    { code: "R661", hex: "#CF3F5F", catalog: "MATERIAL COLOR 4" },
    { code: "R669", hex: "#CE1C50", catalog: "MATERIAL COLOR 4" },
    { code: "X775", hex: "#E44509", catalog: "MATERIAL COLOR 4" },
    { code: "X773", hex: "#E95B0E", catalog: "MATERIAL COLOR 4" },
    { code: "Y778", hex: "#CB9519", catalog: "MATERIAL COLOR 4" },
    { code: "X776", hex: "#CC7A19", catalog: "MATERIAL COLOR 4" },
    { code: "W880", hex: "#B59F77", catalog: "MATERIAL COLOR 4" },
    { code: "W888", hex: "#B39C6C", catalog: "MATERIAL COLOR 4" },
    { code: "W886", hex: "#AC9B79", catalog: "MATERIAL COLOR 4" },
    { code: "81212", hex: "#947C55", catalog: "MATERIAL COLOR 4" },
    { code: "W885", hex: "#A5885C", catalog: "MATERIAL COLOR 4" },
    { code: "W881", hex: "#A18A59", catalog: "MATERIAL COLOR 4" },
    { code: "4954", hex: "#76AB6C", catalog: "MATERIAL COLOR 4" },
    { code: "G445", hex: "#599E19", catalog: "MATERIAL COLOR 4" },
    { code: "G446", hex: "#35981E", catalog: "MATERIAL COLOR 4" },
    { code: "B443", hex: "#498C2D", catalog: "MATERIAL COLOR 4" },
    { code: "G448", hex: "#058B48", catalog: "MATERIAL COLOR 4" },
    { code: "G447", hex: "#077E68", catalog: "MATERIAL COLOR 4" },
    { code: "G442", hex: "#4C6A65", catalog: "MATERIAL COLOR 4" },
    { code: "G441", hex: "#39786C", catalog: "MATERIAL COLOR 4" },
    { code: "P117", hex: "#70649C", catalog: "MATERIAL COLOR 4" },
    { code: "P118", hex: "#4F3885", catalog: "MATERIAL COLOR 4" },
    { code: "P116", hex: "#834A85", catalog: "MATERIAL COLOR 4" },
    { code: "B552", hex: "#1C86A9", catalog: "MATERIAL COLOR 4" },
    { code: "B553", hex: "#056AA3", catalog: "MATERIAL COLOR 4" },
    { code: "3326A", hex: "#24529E", catalog: "MATERIAL COLOR 4" },
    { code: "B555", hex: "#1D478D", catalog: "MATERIAL COLOR 4" },
    { code: "B557", hex: "#4D537A", catalog: "MATERIAL COLOR 4" },
    { code: "B556", hex: "#5B5F83", catalog: "MATERIAL COLOR 4" },
    { code: "E336", hex: "#808481", catalog: "MATERIAL COLOR 4" },
    { code: "E338", hex: "#667474", catalog: "MATERIAL COLOR 4" },
    { code: "E335", hex: "#6A7174", catalog: "MATERIAL COLOR 4" },
    { code: "W226", hex: "#746160", catalog: "MATERIAL COLOR 4" },
    { code: "2647", hex: "#AE5E4B", catalog: "MATERIAL COLOR 4" },
    { code: "N228", hex: "#AF6B31", catalog: "MATERIAL COLOR 4" },
    { code: "荧光白 (fluor.white)", hex: "#9A9BA1", catalog: "MATERIAL COLOR 4" },
    { code: "01", hex: "#97978D", catalog: "MATERIAL COLOR 4" },
    { code: "C001", hex: "#464F59", catalog: "MATERIAL COLOR 4" },
  ],
};

export function getSharedColor(hex: string): SharedColor | undefined {
  const want = hex.trim().toUpperCase();
  return SHARED_COLORS.find((c) => c.hex.toUpperCase() === want);
}

/** Colours a given factory can make, split by catalogue (MANDY has two). */
export function colorsByCatalog(id: FactoryId): { catalog: string; colors: FactoryColor[] }[] {
  return FACTORIES[id].catalogs.map((catalog) => ({
    catalog,
    colors: FACTORY_COLORS[id].filter((c) => c.catalog === catalog),
  }));
}
