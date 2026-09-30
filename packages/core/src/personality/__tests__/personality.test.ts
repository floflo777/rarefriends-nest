import { describe, expect, it } from "vitest";
import { FAMILY_NAMES } from "../../protocol/constants.js";
import type { MoodState, Personality, Vitals } from "../../types.js";
import { describe as describeFriend, nameFor } from "../describe.js";
import { seedHash, seedPick } from "../hash.js";
import { animationFor, bedtimeHour, frameIndexAt, hourDistance, moodState, utcHour } from "../mood.js";
import { speechLine, speechPool } from "../speech.js";
import { HUNGER_THRESHOLDS, MAX_SPEECH_CHARS, SECRET_HABITS, SPEECH, SYLLABLES, TEMPERAMENTS, URGENT_LINES } from "../tables.js";

const MOODS: readonly MoodState[] = ["content", "hungry", "restless", "proud", "sleepy", "thrifty", "asleep"];

function vitals(over: Partial<Vitals> = {}): Vitals {
  return {
    hunger: 0,
    strength: 0.5,
    territory: 1,
    mood: 0.9,
    savings: 0.4,
    awake: true,
    weeklyRfFromStream: 3_329,
    streamShare: 3.9e-4,
    ...over,
  };
}

const FRIEND_1969 = { tokenId: 1969n, seed: 1969, family: 4 };

/** Unix seconds for a given UTC hour today-ish (day 20_000 since epoch). */
function atHour(hour: number): number {
  return 20_000 * 86_400 + hour * 3600;
}

describe("describe()", () => {
  it("is deterministic and reads family/seed from the Friend when not given", () => {
    const a = describeFriend(FRIEND_1969, 1969, 4);
    const b = describeFriend(FRIEND_1969, 1969, 4);
    const c = describeFriend(FRIEND_1969);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a.family).toBe("Asymmetry");
    expect(a.seed).toBe(1969);
    expect(a.hungerThreshold).toBe(0.45);
    expect(a.temperament).toMatch(/Quirky/);
    expect(a.favouriteHour).toBeGreaterThanOrEqual(0);
    expect(a.favouriteHour).toBeLessThan(24);
    expect(Number.isInteger(a.favouriteHour)).toBe(true);
    expect(SECRET_HABITS[4]).toContain(a.secretHabit);
    expect(a.name).toMatch(/^[A-Z][a-z]+$/);
  });

  it("different seeds give different names (and the same seed never changes)", () => {
    expect(nameFor(1969, 4)).not.toBe(nameFor(1970, 4));
    expect(nameFor(1969, 4)).toBe(nameFor(1969, 4));
    const names = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) names.add(nameFor(seed, 4));
    expect(names.size).toBeGreaterThanOrEqual(90);
    // the same seed in another family draws from another table
    expect(nameFor(1969, 0)).not.toBe(nameFor(1969, 7));
  });

  it("names are 2 or 3 syllables from the family table and both lengths occur", () => {
    let two = 0;
    let three = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const name = nameFor(seed, 0).toLowerCase();
      const t = SYLLABLES[0]!;
      const twoSyll = t.onsets.some((o) => t.endings.some((e) => o + e === name));
      const threeSyll = t.onsets.some((o) => t.middles.some((m) => t.endings.some((e) => o + m + e === name)));
      expect(twoSyll || threeSyll, name).toBe(true);
      if (twoSyll) two++;
      if (threeSyll) three++;
    }
    expect(two).toBeGreaterThan(0);
    expect(three).toBeGreaterThan(0);
  });

  it("family tables cover all nine families with the documented thresholds", () => {
    expect(SYLLABLES).toHaveLength(FAMILY_NAMES.length);
    expect(TEMPERAMENTS).toHaveLength(FAMILY_NAMES.length);
    expect(SECRET_HABITS).toHaveLength(FAMILY_NAMES.length);
    expect(SPEECH).toHaveLength(FAMILY_NAMES.length);
    expect(HUNGER_THRESHOLDS).toEqual([0.6, 0.4, 0.35, 0.4, 0.45, 0.2, 0.45, 0.35, 0.4]);
    for (let f = 0; f < FAMILY_NAMES.length; f++) {
      const p = describeFriend({ tokenId: 7n }, 7, f);
      expect(p.family).toBe(FAMILY_NAMES[f]);
      expect(p.hungerThreshold).toBe(HUNGER_THRESHOLDS[f]);
    }
    expect(() => describeFriend({ tokenId: 1n }, 1, 9)).toThrow(RangeError);
  });

  it("seedHash/seedPick are stable and handle big token ids", () => {
    expect(seedHash(1969, "hour")).toBe(seedHash(1969, "hour"));
    expect(seedHash(1969, "hour")).not.toBe(seedHash(1969, "habit"));
    expect(seedHash(2 ** 40 + 5)).not.toBe(seedHash(5));
    expect(seedPick(["a", "b", "c"], 3)).toBe(seedPick(["a", "b", "c"], 3));
    expect(() => seedPick([], 1)).toThrow(RangeError);
  });
});

describe("moodState()", () => {
  const p: Personality = { ...describeFriend(FRIEND_1969), favouriteHour: 9 }; // bedtime 21
  const noon = atHour(12);

  it("content by default, sleepy near the favourite hour, asleep near bedtime", () => {
    expect(moodState(vitals(), p, noon)).toBe("content");
    expect(moodState(vitals(), p, atHour(9.5))).toBe("sleepy");
    expect(moodState(vitals(), p, atHour(8))).toBe("sleepy");
    expect(moodState(vitals(), p, atHour(7.9))).toBe("content");
    expect(bedtimeHour(p)).toBe(21);
    expect(moodState(vitals(), p, atHour(21))).toBe("asleep");
    expect(moodState(vitals(), p, atHour(22))).toBe("asleep");
    expect(moodState(vitals(), p, atHour(22.1))).toBe("content");
  });

  it("hunger wakes it up at 0.9 and drives hungry/restless by family threshold", () => {
    expect(moodState(vitals({ hunger: 0.5 }), p, atHour(21))).toBe("asleep");
    expect(moodState(vitals({ hunger: 0.9 }), p, atHour(21))).toBe("restless");
    expect(moodState(vitals({ hunger: 0.44 }), p, noon)).toBe("content");
    expect(moodState(vitals({ hunger: 0.45 }), p, noon)).toBe("hungry");
    expect(moodState(vitals({ hunger: 0.74 }), p, noon)).toBe("hungry");
    expect(moodState(vitals({ hunger: 0.75 }), p, noon)).toBe("restless");
    const hoverer: Personality = { ...p, hungerThreshold: 0.2 };
    expect(moodState(vitals({ hunger: 0.2 }), hoverer, noon)).toBe("hungry");
    expect(moodState(vitals({ hunger: 0.5 }), hoverer, noon)).toBe("restless");
  });

  it("proud after a promotion or upgrade within 24 h, thrifty when savings grew", () => {
    expect(moodState(vitals(), p, noon, [{ action: "promote", at: noon - 3600 }])).toBe("proud");
    expect(moodState(vitals(), p, noon, [{ action: "upgrade", at: noon - 86_400 }])).toBe("proud");
    expect(moodState(vitals(), p, noon, [{ action: "upgrade", at: noon - 86_401 }])).toBe("content");
    expect(moodState(vitals(), p, noon, [{ action: "claim", at: noon - 10 }])).toBe("content");
    expect(moodState(vitals(), p, noon, [{ action: "promote", at: noon + 10 }])).toBe("content");
    expect(moodState(vitals({ savings: 0.5 }), p, noon, [], 0.4)).toBe("thrifty");
    expect(moodState(vitals({ savings: 0.4 }), p, noon, [], 0.4)).toBe("content");
    // hunger outranks pride, pride outranks thrift
    expect(moodState(vitals({ hunger: 0.5, savings: 0.5 }), p, noon, [{ action: "promote", at: noon }], 0.1)).toBe("hungry");
    expect(moodState(vitals({ savings: 0.5 }), p, noon, [{ action: "promote", at: noon }], 0.1)).toBe("proud");
  });

  it("an inactive Friend is asleep regardless of the clock", () => {
    expect(moodState(vitals({ awake: false, hunger: 1 }), p, noon)).toBe("asleep");
  });

  it("clock helpers", () => {
    expect(utcHour(atHour(13.5))).toBeCloseTo(13.5, 9);
    expect(hourDistance(23, 1)).toBe(2);
    expect(hourDistance(1, 23)).toBe(2);
    expect(hourDistance(12, 12)).toBe(0);
  });

  it("animationFor gives a clip and frame rate for every mood", () => {
    for (const m of MOODS) {
      const a = animationFor(m);
      expect(["idle", "walk"]).toContain(a.clip);
      expect(a.fps).toBeGreaterThan(0);
    }
    expect(animationFor("restless").clip).toBe("walk");
    expect(animationFor("asleep").fps).toBeLessThan(animationFor("content").fps);
    const idx = frameIndexAt(animationFor("content"), 10.3);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(32);
  });
});

describe("speechLine()", () => {
  it("every authored line is 3-5 per (family, mood), <= 22 chars, ASCII only", () => {
    for (let f = 0; f < SPEECH.length; f++) {
      for (const m of MOODS) {
        const lines = SPEECH[f]![m];
        expect(lines.length, `${FAMILY_NAMES[f]}/${m}`).toBeGreaterThanOrEqual(3);
        expect(lines.length, `${FAMILY_NAMES[f]}/${m}`).toBeLessThanOrEqual(5);
        for (const line of lines) {
          expect(line.length, line).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
          expect(line, line).toMatch(/^[\x20-\x7e]+$/);
        }
      }
    }
    for (const line of URGENT_LINES) expect(line.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
  });

  it("is deterministic per (seed, day, mood) and comes from the family pool", () => {
    const p = describeFriend(FRIEND_1969);
    const v = vitals({ hunger: 0.5 });
    const day = 20_000 * 86_400;
    for (const m of MOODS) {
      const line = speechLine(p, m, v, day + 100);
      expect(line).toBe(speechLine(p, m, v, day + 80_000)); // same UTC day
      expect(line.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
      expect(speechPool(p, m, v)).toContain(line);
      expect(SPEECH[4]![m]).toContain(line);
    }
    // across many days, more than one line of the pool is used
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) seen.add(speechLine(p, "content", v, (20_000 + d) * 86_400));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("a full week unclaimed adds the urgent lines to the hungry pool", () => {
    const p = describeFriend(FRIEND_1969);
    expect(speechPool(p, "hungry", vitals({ hunger: 1 }))).toEqual([...SPEECH[4]!.hungry, ...URGENT_LINES]);
    expect(speechPool(p, "hungry", vitals({ hunger: 0.6 }))).toEqual(SPEECH[4]!.hungry);
    expect(speechPool(p, "content", vitals({ hunger: 1 }))).toEqual(SPEECH[4]!.content);
  });

  it("falls back to hashing the name when the personality carries no seed", () => {
    const p = describeFriend(FRIEND_1969);
    const { seed: _seed, ...noSeed } = p;
    const line = speechLine(noSeed, "content", vitals(), 0);
    expect(line).toBe(speechLine(noSeed, "content", vitals(), 0));
    expect(SPEECH[4]!.content).toContain(line);
  });
});
