import type { Digest, SlackMessage } from "./types";

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const TOP_THREAD_COUNT = 3;

/**
 * Build the weekly digest for one Slack channel.
 *
 * The week starts at `weekStart` and runs for 7 days.
 *
 * Returns:
 *  - topThreads: the 3 most active threads this week
 *  - unanswered: questions posted this week that nobody has answered
 */
export function buildDigest(messages: SlackMessage[], weekStart: Date): Digest {
  const start = weekStart.getTime() / 1000;
  const end = start + WEEK_SECONDS;

  return {
    topThreads: getTopThreads(messages, start, end),
    unanswered: getUnanswered(messages, start, end),
  };
}

/**
 * Rank threads by the number of replies posted inside [start, end).
 *
 * We deliberately don't use the parent's `reply_count`: it is an all-time
 * total, so long-running threads (megathreads, or threads that took off after
 * the week ended) would outrank threads that were actually busy this week.
 */
function getTopThreads(
  messages: SlackMessage[],
  start: number,
  end: number,
): Digest["topThreads"] {
  const parents = new Map<string, SlackMessage>();
  const repliesThisWeek = new Map<string, number>();

  for (const msg of messages) {
    if (!isReply(msg)) {
      parents.set(msg.ts, msg);
      continue;
    }

    // Bot posts and join notices aren't member activity.
    if (msg.subtype) continue;
    if (!inRange(msg.ts, start, end)) continue;

    repliesThisWeek.set(msg.thread_ts, (repliesThisWeek.get(msg.thread_ts) ?? 0) + 1);
  }

  return [...repliesThisWeek]
    // A thread's parent may predate the week; that's fine. But if the parent
    // isn't in the export at all we have no text to show, so skip it.
    .filter(([threadTs]) => parents.has(threadTs))
    .sort(([tsA, a], [tsB, b]) => b - a || Number(tsA) - Number(tsB))
    .slice(0, TOP_THREAD_COUNT)
    .map(([threadTs, count]) => ({
      thread_ts: threadTs,
      text: parents.get(threadTs)!.text,
      repliesThisWeek: count,
    }));
}

/**
 * Top-level messages posted in [start, end) that contain a "?" and got no
 * answer during the week.
 *
 * "Answered" means at least one in-week reply from a human other than the
 * asker. Self-replies ("bump", "anyone?") and bot auto-replies don't count,
 * and neither do replies posted after the week ended.
 */
function getUnanswered(
  messages: SlackMessage[],
  start: number,
  end: number,
): Digest["unanswered"] {
  const askerByTs = new Map<string, string>();
  for (const msg of messages) {
    if (!isReply(msg)) askerByTs.set(msg.ts, msg.user);
  }

  const answered = new Set<string>();
  for (const msg of messages) {
    if (!isReply(msg) || msg.subtype) continue;
    if (!inRange(msg.ts, start, end)) continue;
    if (msg.user === askerByTs.get(msg.thread_ts)) continue;
    answered.add(msg.thread_ts);
  }

  return messages
    .filter(
      (msg) =>
        !isReply(msg) &&
        !msg.subtype && // skip bot posts like "Got questions? Bring them!"
        inRange(msg.ts, start, end) &&
        msg.text.includes("?") &&
        !answered.has(msg.ts),
    )
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .map(({ ts, user, text }) => ({ ts, user, text }));
}

/** A thread reply, as opposed to a top-level message or thread parent. */
function isReply(msg: SlackMessage): msg is SlackMessage & { thread_ts: string } {
  return msg.thread_ts !== undefined && msg.thread_ts !== msg.ts;
}

function inRange(ts: string, start: number, end: number): boolean {
  const t = Number(ts);
  return t >= start && t < end;
}
