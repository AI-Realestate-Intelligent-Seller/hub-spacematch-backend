import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ReelOrder } from "../../src/modules/reel-studio/reel.model.js";
import { render } from "../../src/modules/reel-studio/reel-render.js";

test("renders a branded reel, reuses vertical output, and applies caption edits on the same timeline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-reel-test-"));
  try {
    const source = join(dir, "source.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=500:sample_rate=48000", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
    const footage = await readFile(source);
    const outputs = new Map<string, Buffer>();
    let plans = 0;
    const io: NonNullable<Parameters<typeof render>[4]> = {
      readObject: async () => new Response(new Uint8Array(footage)),
      downloadDriveClip: async () => { throw new Error("Unexpected Drive access."); },
      transcribe: async () => [{ text: "Welcome home", start: 0.15, end: 1 }],
      plan: async () => { plans++; return [{ clip: 0, start: 0, end: 2 }]; },
      putObject: async (key, body) => { outputs.set(key, body); },
    };
    const order: ReelOrder = {
      id: "fixture", owner: "agent@example.com", agentName: "Test Agent", tier: "quick", price: 0, free: 1,
      status: "editing", clips: [{ id: "hub:fixture", name: "Fixture", keys: ["fixture"] }],
      options: { title: "Welcome home", logo: true, nameBar: true, endCard: true, captions: true, lengthSec: 15, formats: ["instagram", "tiktok", "fb_feed", "youtube"] },
      payments: [], revisions: [], outputs: [], captionLines: [], legacyCostCredits: 0, deliveryNote: null,
      timeline: null, version: 0, generation: 1, notes: null, stage: null, statusNote: null, question: null,
      answer: null, queuedAt: null, pickedUpAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const stages: string[] = [];
    const first = await render(order, AbortSignal.timeout(120_000), async stage => { stages.push(stage); }, "first", io);
    assert.equal(first.outputs.length, 4);
    assert.equal(outputs.size, 3);
    assert.equal(first.outputs[0]?.key, first.outputs[1]?.key);
    assert.equal(first.captionLines[0]?.text, "Welcome home");
    assert.deepEqual(stages, ["clips", "watch", "cut", "style", "export", "check"]);
    const second = await render({
      ...order, ...first, revisions: [{ kind: "captions", note: "Correct greeting", paid: false, edits: [{ i: 0, text: "Welcome to the listing" }] }],
    }, AbortSignal.timeout(120_000), async () => {}, "second", io);
    assert.equal(plans, 1);
    assert.deepEqual(second.timeline, first.timeline);
    assert.equal(second.captionLines[0]?.text, "Welcome to the listing");
    assert.equal(second.version, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
