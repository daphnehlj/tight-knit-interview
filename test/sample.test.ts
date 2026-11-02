import { describe, expect, it } from "vitest";
import { buildDigest } from "../src/digest";
import type { Digest, SlackMessage } from "../src/types";
import sampleMessages from "../data/sample-messages.json";
import sampleDigest from "../data/sample-digest.json";

const weekStart = new Date("2026-09-21T00:00:00Z");

describe("buildDigest on the sample", () => {
  it("returns an empty digest for an empty channel", () => {
    expect(buildDigest([], weekStart)).toEqual({ topThreads: [], unanswered: [] });
  });

  it("produces sample-digest.json from sample-messages.json", () => {
    const result = buildDigest(sampleMessages as SlackMessage[], weekStart);
    expect(result).toEqual(sampleDigest as Digest);
  });
});

describe("topThreads", () => {
  // weekStart = 1789948800, week end = 1790553600
  const before = (n: number) => `${1789948800 - 1000 + n}.000000`;
  const during = (n: number) => `${1789948800 + 1000 + n}.000000`;
  const after = (n: number) => `${1790553600 + 1000 + n}.000000`;

  const parent = (ts: string, text: string, reply_count: number): SlackMessage => ({
    ts, thread_ts: ts, user: "U1", text, reply_count,
  });
  const reply = (ts: string, thread_ts: string, extra: Partial<SlackMessage> = {}): SlackMessage => ({
    ts, thread_ts, user: "U2", text: "reply", ...extra,
  });

  it("matches the sample digest", () => {
    const result = buildDigest(sampleMessages as SlackMessage[], weekStart);
    expect(result.topThreads).toEqual((sampleDigest as Digest).topThreads);
  });

  it("ranks by replies this week, not all-time reply_count, and returns at most 3", () => {
    const old = before(0); // parent before the week, replies during it
    const mega = during(1); // huge reply_count, but most replies after the week
    const a = during(2);
    const b = during(3);
    const messages: SlackMessage[] = [
      parent(old, "old parent", 3),
      reply(during(10), old), reply(during(11), old), reply(during(12), old),
      parent(mega, "megathread", 10),
      reply(during(20), mega),
      ...Array.from({ length: 9 }, (_, i) => reply(after(i), mega)),
      parent(a, "thread a", 2),
      reply(during(30), a), reply(during(31), a),
      reply(during(32), a, { subtype: "bot_message" }), // bots don't count
      parent(b, "thread b", 1),
      reply(during(40), b),
    ];

    expect(buildDigest(messages, weekStart).topThreads).toEqual([
      { thread_ts: old, text: "old parent", repliesThisWeek: 3 },
      { thread_ts: a, text: "thread a", repliesThisWeek: 2 },
      // tie at 1 broken by earliest thread_ts
      { thread_ts: mega, text: "megathread", repliesThisWeek: 1 },
    ]);
  });
});

describe("unanswered", () => {
  const before = (n: number) => `${1789948800 - 1000 + n}.000000`;
  const during = (n: number) => `${1789948800 + 1000 + n}.000000`;
  const after = (n: number) => `${1790553600 + 1000 + n}.000000`;

  const msg = (ts: string, text: string, extra: Partial<SlackMessage> = {}): SlackMessage => ({
    ts, user: "ASKER", text, ...extra,
  });
  const reply = (ts: string, thread_ts: string, user: string, extra: Partial<SlackMessage> = {}): SlackMessage => ({
    ts, thread_ts, user, text: "reply", ...extra,
  });

  it("lists in-week top-level questions with no real answer, oldest first", () => {
    const noReplies = during(1);
    const selfBump = during(2);
    const botReply = during(3);
    const answered = during(4);
    const lateAnswer = during(5);
    const botParent = during(6);
    const statement = during(7);
    const oldQuestion = before(0);

    const messages: SlackMessage[] = [
      msg(lateAnswer, "late answer?", { thread_ts: lateAnswer, reply_count: 1 }),
      reply(after(1), lateAnswer, "HELPER"),
      msg(noReplies, "no replies?"),
      msg(selfBump, "self bump?", { thread_ts: selfBump, reply_count: 1 }),
      reply(during(20), selfBump, "ASKER", { text: "bump" }),
      msg(botReply, "bot reply?", { thread_ts: botReply, reply_count: 1 }),
      reply(during(21), botReply, "BOT", { subtype: "bot_message" }),
      msg(answered, "answered?", { thread_ts: answered, reply_count: 1 }),
      reply(during(22), answered, "HELPER"),
      reply(during(23), answered, "OTHER", { text: "a reply with a question?" }),
      msg(botParent, "Got questions?", { user: "BOT", subtype: "bot_message" }),
      msg(statement, "just a statement"),
      msg(oldQuestion, "old question?"),
    ];

    expect(buildDigest(messages, weekStart).unanswered.map((q) => q.text)).toEqual([
      "no replies?",
      "self bump?",
      "bot reply?",
      "late answer?",
    ]);
    expect(buildDigest(messages, weekStart).unanswered[0]).toEqual({
      ts: noReplies, user: "ASKER", text: "no replies?",
    });
  });
});
