// Pure helpers of the Lofty, YouTube and Push connectors (no network, no database).
import assert from "node:assert/strict";
import { test } from "node:test";
import { digits10, matchMember } from "../../src/integrations/lofty/lofty.client.js";
import { sendPush } from "../../src/integrations/push/push.client.js";
import { streetRegex, videoId } from "../../src/integrations/youtube/youtube.client.js";

test("lofty: member matched by email first, then by name", () => {
  const list = [
    { id: 1, email: "anna@cbrealty.com", firstName: "Anna", lastName: "Kowalski" },
    { id: 2, email: "mike@gmail.com", firstName: "Michael", lastName: "Hurrikan-Smith" },
  ];
  assert.equal(matchMember(list, "ANNA@cbrealty.com", "Someone Else"), 1);
  assert.equal(matchMember(list, "michael@spacematchinc.com", "Michael Hurrikan Smith"), 2);
  assert.equal(matchMember(list, "x@y.com", "Nobody Here"), undefined);
  assert.equal(matchMember(list, "x@y.com", ""), undefined);
});

test("lofty: phone digits", () => {
  assert.equal(digits10("+1 (312) 555-0100"), "3125550100");
  assert.equal(digits10("312.555.0100"), "3125550100");
  assert.equal(digits10(undefined), "");
});

test("youtube: video id from every link form", () => {
  for (const u of ["https://www.youtube.com/shorts/abcdefghijk", "https://youtu.be/abcdefghijk", "https://www.youtube.com/watch?si=x&v=abcdefghijk", "https://youtube.com/embed/abcdefghijk"]) {
    assert.equal(videoId(u), "abcdefghijk", u);
  }
  assert.equal(videoId("https://example.com/x"), undefined);
});

test("youtube: street matching in titles", () => {
  const re = streetRegex("2147 W Thomas St, Chicago, IL 60622")!;
  assert.ok(re.test("Just listed: 2147 W Thomas #shorts"));
  assert.ok(re.test("2147 West Thomas in Ukrainian Village"));
  assert.ok(re.test("2147 Thomas St tour"));
  assert.ok(!re.test("21470 W Thomas"));
  assert.ok(!re.test("2147 W Thomasville"));
  assert.equal(streetRegex("Lot 5, Some Rd"), null);
});

test("push: without VAPID keys nothing is sent", async () => {
  // Only meaningful when the test runs without keys; with keys it just checks the shape.
  const r = await sendPush([], { title: "t", body: "b", url: "/" }, 60);
  assert.equal(r.sent, 0);
  assert.deepEqual(r.gone, []);
});
