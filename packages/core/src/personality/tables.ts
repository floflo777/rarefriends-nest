/**
 * Authored tables, indexed by family id (0..8, FAMILY_NAMES order). Inputs are chain
 * state, so two people looking at the same Friend see the same pet.
 */
import type { MoodState } from "../types.js";

export interface SyllableTable {
  onsets: readonly string[];
  middles: readonly string[];
  endings: readonly string[];
}

/** One table per family; a name is onset + (middle)? + ending. */
export const SYLLABLES: readonly SyllableTable[] = [
  // 0 Skeleton: dry, hard sounds
  {
    onsets: ["kor", "bon", "tar", "gral", "mor", "dun", "vek", "ost", "ru", "nak", "gor", "hel"],
    middles: ["ta", "ro", "un", "ek", "al", "om", "ir", "us", "en", "ar", "ok", "ul"],
    endings: ["ak", "dur", "os", "eth", "un", "gor", "ik", "ar", "um", "ost", "ek", "al"],
  },
  // 1 Mask: hushed, sibilant
  {
    onsets: ["shi", "vel", "sa", "mis", "nyx", "sol", "hu", "ves", "ila", "zen", "mo", "sy"],
    middles: ["ra", "shu", "li", "ve", "na", "si", "mo", "the", "ru", "ze", "lo", "ni"],
    endings: ["sha", "vel", "ris", "no", "th", "sa", "lie", "mir", "ne", "zu", "vis", "lo"],
  },
  // 2 Family: warm, round
  {
    onsets: ["ma", "po", "lu", "ben", "tilly", "ro", "nan", "bo", "pip", "mol", "ta", "wil"],
    middles: ["bo", "lo", "ma", "ni", "pa", "de", "ro", "mi", "la", "be", "no", "ti"],
    endings: ["by", "lo", "ma", "nie", "pa", "dy", "ro", "mie", "la", "bee", "no", "ty"],
  },
  // 3 Cellular: clicking, quick
  {
    onsets: ["ki", "zit", "pex", "quo", "tik", "cel", "bix", "nu", "vix", "dit", "ox", "pli"],
    middles: ["ki", "ta", "pi", "zo", "ni", "cu", "bi", "xa", "di", "to", "qi", "li"],
    endings: ["k", "tix", "po", "zz", "nik", "cle", "bit", "x", "dix", "to", "q", "lit"],
  },
  // 4 Asymmetry: off-kilter
  {
    onsets: ["wob", "ska", "tilt", "jib", "ask", "lop", "ziz", "kel", "yaw", "brik", "olo", "fen"],
    middles: ["a", "ke", "il", "jo", "u", "op", "za", "e", "aw", "ri", "lo", "ne"],
    endings: ["ble", "wy", "t", "jo", "ew", "sy", "ag", "k", "wick", "le", "ff", "dle"],
  },
  // 5 Hoverer: airy, nervous
  {
    onsets: ["fli", "hum", "wisp", "ze", "aer", "fla", "tre", "hov", "pi", "sky", "whi", "lif"],
    middles: ["ti", "mi", "pe", "fi", "e", "ri", "vi", "li", "a", "we", "hi", "ne"],
    endings: ["tt", "mmer", "per", "fy", "el", "ria", "ver", "ling", "a", "wen", "ff", "ne"],
  },
  // 6 Colossus: heavy, slow
  {
    onsets: ["bro", "grum", "tor", "mag", "doom", "ol", "krag", "bou", "tho", "gron", "mo", "bal"],
    middles: ["go", "mu", "ro", "ga", "do", "lo", "ka", "bo", "tho", "gu", "mo", "ba"],
    endings: ["g", "mund", "rok", "gar", "dom", "lom", "kar", "boul", "thor", "gunn", "mok", "bald"],
  },
  // 7 Sparkling: bright, light
  {
    onsets: ["twi", "gli", "spa", "lumi", "bri", "sti", "fizz", "dazz", "shim", "sun", "pip", "glo"],
    middles: ["li", "nki", "rk", "mi", "ght", "ll", "zi", "le", "me", "ny", "pi", "wi"],
    endings: ["nkle", "tter", "rk", "na", "ght", "lla", "zy", "le", "mer", "ny", "pin", "w"],
  },
  // 8 Hollow: soft, open vowels
  {
    onsets: ["ao", "eve", "hol", "nu", "oa", "ely", "vo", "soo", "ea", "ulo", "mor", "ia"],
    middles: ["o", "ve", "lo", "u", "a", "ly", "vo", "o", "e", "lu", "ro", "a"],
    endings: ["n", "ven", "low", "ne", "ah", "lyn", "vo", "on", "eh", "lune", "row", "ah"],
  },
];

export const TEMPERAMENTS: readonly string[] = [
  "Stoic. Says little, forgets nothing, never begs.",
  "Secretive. Watches from behind the mask and keeps its own counsel.",
  "Social. Happiest in a full household, doting on the pups.",
  "Restless. Splits its attention a hundred ways and never sits still.",
  "Quirky. Does everything slightly sideways, and means it.",
  "Anxious. Paces, hovers, checks the bowl twice before eating.",
  "Slow and strong. Takes its time; when it moves, it moves.",
  "Cheerful. Finds something to shine about every single day.",
  "Melancholic. Gentle, quiet, a little far away.",
];

/** Hunger level (0..1) at which each family starts to show it. */
export const HUNGER_THRESHOLDS: readonly number[] = [0.6, 0.4, 0.35, 0.4, 0.45, 0.2, 0.45, 0.35, 0.4];

export const SECRET_HABITS: readonly (readonly string[])[] = [
  [
    "counts its own ribs before sleeping",
    "hums an old marching tune when nobody watches",
    "arranges pebbles by weight",
    "stares at the moon for exactly one hour",
    "polishes the same bone every morning",
    "keeps a list of every claim it ever received",
  ],
  [
    "tries on other masks in the dark",
    "whispers the day's block number to itself",
    "hides one coin where nobody will find it",
    "practises three different laughs",
    "reads the household's letters upside down",
    "swaps places with its shadow at midnight",
  ],
  [
    "names every pup twice",
    "saves the best crumb for the smallest",
    "hums lullabies to the wallet",
    "sets an extra bowl for a guest who never comes",
    "counts heads before every nap",
    "keeps a scrapbook of promotions",
  ],
  [
    "divides its food into exactly sixty-four piles",
    "races its own reflection",
    "rearranges the furniture every hour",
    "counts to a thousand, twice, before breakfast",
    "tries to be in two rooms at once",
    "practises splitting a single hair",
  ],
  [
    "walks in circles that never quite close",
    "keeps its left pocket fuller than the right",
    "sleeps with one eye open, alternating nightly",
    "collects odd-numbered pebbles only",
    "tilts every picture it passes",
    "hops on the wrong foot on purpose",
  ],
  [
    "checks the door is locked, then checks again",
    "counts the seconds between breaths",
    "hovers one finger above the ground, never touching",
    "practises emergency landings",
    "keeps a snack hidden in every corner",
    "rehearses what to say if the stream stops",
  ],
  [
    "moves one pebble a day toward a wall it is building",
    "sits in the same spot until it leaves a dent",
    "breathes in for a minute, out for a minute",
    "lifts the house a little to see what is under it",
    "counts thunder without flinching",
    "naps standing up",
  ],
  [
    "polishes each sparkle individually",
    "dances when the stream refreshes",
    "collects reflections in a jar",
    "sings to the coins so they shine",
    "waves at every passing Friend",
    "practises its most dazzling entrance",
  ],
  [
    "listens to the wind pass through it",
    "keeps a stone warm for no one",
    "writes letters it never sends",
    "watches the same sunset from memory",
    "hums a note nobody else can hear",
    "leaves the door open a crack, just in case",
  ],
];

/** 3-5 short lines per (family, mood), each <= 22 characters, no emoji. */
export const SPEECH: readonly Readonly<Record<MoodState, readonly string[]>>[] = [
  // 0 Skeleton
  {
    content: ["All quiet. Good.", "Bones rest easy.", "Nothing to report.", "Here. Still yours."],
    hungry: ["Rewards sit unclaimed.", "Bowl waits. So do I.", "Feed when ready."],
    restless: ["Too much unclaimed.", "A week of RF piles up.", "Claim it. I insist."],
    proud: ["Stronger. As planned.", "Weight up. Noted.", "A step up the ladder."],
    sleepy: ["Eyes closing. Almost.", "The hour grows late.", "Rest soon."],
    thrifty: ["The wallet grew.", "Savings hold. Good.", "Kept, not spent."],
    asleep: ["Zzz.", "Resting the bones.", "Do not wake."],
  },
  // 1 Mask
  {
    content: ["I know something.", "Nothing to see here.", "Behind the mask: calm.", "Secrets keep well."],
    hungry: ["The bowl is empty. Hm.", "I would not refuse RF.", "Unclaimed. Curious."],
    restless: ["Something piles up...", "Secrets pile up. Hm.", "RF waits. I noticed."],
    proud: ["Did you see? No? Good.", "Stronger now. Quietly.", "Promoted. Tell no one."],
    sleepy: ["The mask slips a bit.", "Nearly time to vanish.", "Yawning. Do not look."],
    thrifty: ["The vault grew. Shh.", "Savings up. Secret.", "More tucked away."],
    asleep: ["...", "Gone dark.", "The mask sleeps too."],
  },
  // 2 Family
  {
    content: ["Everyone home? Good.", "How are the pups?", "A full house is best.", "Sit with me a while."],
    hungry: ["Dinner time for all?", "The pups are hungry.", "The bowl is bare!"],
    restless: ["A week without dinner!", "Feed the household!", "Rewards pile up!"],
    proud: ["Look how I have grown!", "Tell the whole family!", "Promoted! Group hug!"],
    sleepy: ["Tucking in the pups.", "Bedtime stories soon.", "One more cuddle."],
    thrifty: ["More for the pups.", "The nest egg grew!", "Savings up, all share."],
    asleep: ["Whole house asleep.", "Zzz... pups too.", "Shh, pups sleeping."],
  },
  // 3 Cellular
  {
    content: ["Dividing. Multiplying.", "Busy busy busy.", "Cannot sit still.", "Splitting. Cells."],
    hungry: ["Need fuel to divide!", "No fuel, slow cells.", "RF please, quickly."],
    restless: ["Rewards everywhere!", "Claim claim claim!", "A week unclaimed?!"],
    proud: ["Mitosis of the mind!", "Grew a new layer!", "Bigger. Faster. Yes!"],
    sleepy: ["Cells slowing down...", "Even I rest sometimes.", "Slow division mode."],
    thrifty: ["Savings replicating.", "The wallet divided up!", "More cells, more RF."],
    asleep: ["Dormant.", "Zzz zzz zzz.", "Resting phase."],
  },
  // 4 Asymmetry
  {
    content: ["Slightly to the left.", "All is fine-ish.", "Tilted. On purpose.", "Odd is good."],
    hungry: ["Bowl lopsided. Empty.", "One side is hungry.", "Feed the odd one out."],
    restless: ["RF stacks up sideways.", "A whole week? Askew!", "Claim before I tilt."],
    proud: ["Leaned into it. Won.", "Promoted, off-centre.", "Bigger on one side!"],
    sleepy: ["Drooping. Left side.", "One eye closing.", "Sleep comes crooked."],
    thrifty: ["Savings tilt upward.", "Heavier on one side.", "Odd number, more RF."],
    asleep: ["Zz. z. Zz.", "Sleeping at an angle.", "Lopsided dreams."],
  },
  // 5 Hoverer
  {
    content: ["Hovering. In case.", "Is everything OK? OK.", "Pacing. Calmly.", "Checked twice. Fine."],
    hungry: ["Bowl empty? It is.", "Feed me. I worry.", "I am not panicking."],
    restless: ["SO much unclaimed!", "Please please claim.", "Pacing faster now."],
    proud: ["I did it? I did it!", "Higher! Do not fall.", "Promoted. Nervous."],
    sleepy: ["Hovering lower...", "Too tired to worry.", "Landing soon. Maybe."],
    thrifty: ["Savings up. Phew.", "Wallet safe? Safe.", "A bit more in reserve."],
    asleep: ["Hovering in sleep.", "Zzz... is it safe?", "Dreaming of worries."],
  },
  // 6 Colossus
  {
    content: ["Standing. Firmly.", "All is heavy and well.", "No hurry.", "Solid as ever."],
    hungry: ["Big body. Empty bowl.", "Slow to ask. Hungry.", "Feed the colossus."],
    restless: ["A week. Too long.", "RF piles. Slowly.", "Even I grow impatient."],
    proud: ["Heavier. Stronger.", "The ground shakes.", "Raised. As it should."],
    sleepy: ["Settling down...", "Slow blink. Slower.", "Stone needs rest too."],
    thrifty: ["The hoard grows.", "Savings, heavy. Good.", "Kept every coin."],
    asleep: ["Zzz. Immovable.", "Mountain-still. Zzz.", "Do not try to move me."],
  },
  // 7 Sparkling
  {
    content: ["Shiny day!", "Feeling bright!", "Sparkle sparkle!", "Best day so far!"],
    hungry: ["Snack time? Please!", "Glow dims. Feed me!", "Empty bowl, big smile."],
    restless: ["So much RF to claim!", "Claim it, shiny time!", "Rewards are glowing!"],
    proud: ["I am glowing up!", "Promoted! Yay!", "Brighter than ever!"],
    sleepy: ["Dimming a little...", "Sleepy sparkles.", "Twinkle... yawn."],
    thrifty: ["Savings sparkle!", "The wallet shines!", "More glitter saved!"],
    asleep: ["Zzz sparkle zzz.", "Dreaming in glitter.", "Lights out, softly."],
  },
  // 8 Hollow
  {
    content: ["Quiet. That is fine.", "Still here.", "Wind passes through.", "It is enough."],
    hungry: ["The bowl echoes.", "Hungry, I suppose.", "Feed me, if you like."],
    restless: ["So much left waiting.", "A week. Unclaimed. Oh.", "Rewards gather dust."],
    proud: ["Promoted. It helps.", "A little less hollow.", "Stronger. Almost glad."],
    sleepy: ["Fading softly...", "Sleep is kind.", "The hour dims."],
    thrifty: ["Something kept. Good.", "The wallet is fuller.", "Saved. Small comfort."],
    asleep: ["...", "Empty and resting.", "Zzz. Quietly."],
  },
];

/** Added to the hungry/restless pool when a full week or more sits unclaimed. */
export const URGENT_LINES: readonly string[] = ["A week unclaimed.", "Claim, please.", "Rewards overflow."];

export const MAX_SPEECH_CHARS = 22;

/**
 * Genesis: the 1,024 fixed-supply founders. No registry family, so they get their own
 * tables; the seed is the token id. Nothing here depends on the Generations tables.
 */
export const GENESIS_SYLLABLES: SyllableTable = {
  onsets: ["ar", "ori", "gen", "pri", "ald", "eos", "var", "ur", "kai", "sol", "ath", "nov"],
  middles: ["a", "en", "i", "or", "u", "an", "e", "ur", "o", "em", "is", "al"],
  endings: ["gon", "mus", "dor", "n", "ric", "ta", "os", "an", "el", "is", "mar", "on"],
};

export const GENESIS_TEMPERAMENT = "Founder. Fixed weight, fixed gaze, nothing to prove.";

/** Genesis shows hunger late: 2,000,000 weight accrues rewards fast, and it has seen streams come and go. */
export const GENESIS_HUNGER_THRESHOLD = 0.5;

export const GENESIS_HABITS: readonly string[] = [
  "recites the first block it remembers",
  "keeps a ledger nobody else can read",
  "greets each new Friend by number",
  "counts the reserve every midnight",
  "polishes its portrait, all sixty-four pixels",
  "never sits; founders stand",
];

/** 3-5 lines per mood, <= 22 chars, ASCII only, like SPEECH. */
export const GENESIS_SPEECH: Readonly<Record<MoodState, readonly string[]>> = {
  content: ["Two million. Steady.", "Founders do not fuss.", "I was here first.", "Fixed. As intended."],
  hungry: ["Rewards accrue. Claim.", "The vault fills. Feed.", "Big weight, full bowl."],
  restless: ["A week. Unacceptable.", "Claim it. Now.", "Founders do not wait."],
  proud: ["As it should be.", "Weight, well placed.", "The household grows."],
  sleepy: ["Even founders rest.", "The hour is late.", "Closing the ledger."],
  thrifty: ["The vault grew. Good.", "Kept. Every RF.", "Founder-grade savings."],
  asleep: ["Zzz. Since block one.", "Dormant. Not gone.", "Wake me for the claim."],
};
