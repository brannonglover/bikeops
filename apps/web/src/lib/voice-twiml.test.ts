/**
 * The direct-ring TwiML Twilio executes for an inbound call, and what happens
 * to the caller once the ring is over.
 *
 *   npm run test:voice
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DIAL_RING_SECONDS,
  MAX_DIAL_CLIENTS,
  buildDialResultTwiml,
  buildRingStaffTwiml,
  dialResultOutcome,
  fitParamValue,
} from "./voice-twiml";

const base = {
  callId: "call_123",
  callerLabel: "Jo Rider",
  actionUrl: "https://bbm.bikeops.co/api/webhooks/twilio/voice/dial-result",
  statusCallbackUrl: "https://bbm.bikeops.co/api/webhooks/twilio/voice/status",
};

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("buildRingStaffTwiml", () => {
  it("rings every identity in one answerOnBridge Dial", () => {
    const xml = buildRingStaffTwiml({ ...base, identities: ["shop_a_staff_1", "shop_a_staff_2"] });
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?><Response><Dial /);
    assert.match(xml, /<Dial answerOnBridge="true" /);
    assert.match(xml, new RegExp(`timeout="${DIAL_RING_SECONDS}"`));
    assert.match(xml, /action="https:\/\/bbm\.bikeops\.co\/api\/webhooks\/twilio\/voice\/dial-result" method="POST"/);
    assert.equal(count(xml, "<Client "), 2);
    assert.match(xml, /<Identity>shop_a_staff_1<\/Identity>/);
    assert.match(xml, /<Identity>shop_a_staff_2<\/Identity>/);
  });

  it("puts the status callback on each staff leg", () => {
    const xml = buildRingStaffTwiml({ ...base, identities: ["shop_a_staff_1"] });
    assert.match(
      xml,
      /<Client statusCallback="https:\/\/bbm\.bikeops\.co\/api\/webhooks\/twilio\/voice\/status" statusCallbackEvent="ringing answered completed" statusCallbackMethod="POST">/
    );
  });

  it("passes the call id and caller name the app reads off the invite", () => {
    const xml = buildRingStaffTwiml({ ...base, identities: ["shop_a_staff_1"] });
    assert.match(xml, /<Parameter name="callId" value="call_123"\/>/);
    assert.match(xml, /<Parameter name="name" value="Jo Rider"\/>/);
  });

  it("escapes caller names", () => {
    const xml = buildRingStaffTwiml({
      ...base,
      callerLabel: `Tom & "Jerry" <Bikes>`,
      identities: ["shop_a_staff_1"],
    });
    assert.match(xml, /value="Tom &amp; &quot;Jerry&quot; &lt;Bikes&gt;"/);
  });

  it("caps the Dial at Twilio's client limit", () => {
    const identities = Array.from({ length: MAX_DIAL_CLIENTS + 3 }, (_, i) => `shop_a_staff_${i}`);
    const xml = buildRingStaffTwiml({ ...base, identities });
    assert.equal(count(xml, "<Client "), MAX_DIAL_CLIENTS);
  });

  it("honours an explicit timeout", () => {
    const xml = buildRingStaffTwiml({ ...base, identities: ["x"], timeoutSeconds: 12 });
    assert.match(xml, /timeout="12"/);
  });
});

describe("fitParamValue", () => {
  it("cuts by bytes, not characters", () => {
    const fitted = fitParamValue("é".repeat(100)); // 200 bytes
    assert.ok(Buffer.byteLength(fitted, "utf8") <= 128);
    assert.equal(fitted, "é".repeat(64));
  });

  it("leaves short values alone", () => {
    assert.equal(fitParamValue("Jo Rider"), "Jo Rider");
  });
});

describe("dial result", () => {
  it("hangs up after an answered call", () => {
    assert.equal(dialResultOutcome("completed"), "hangup");
    assert.match(
      buildDialResultTwiml({ dialCallStatus: "completed", unansweredUrl: "https://x/voicemail" }),
      /<Response><Hangup\/><\/Response>$/
    );
  });

  for (const status of ["no-answer", "busy", "failed", "canceled", undefined]) {
    it(`sends the caller on when the ring ends with ${status ?? "no status"}`, () => {
      assert.equal(dialResultOutcome(status), "unanswered");
      assert.match(
        buildDialResultTwiml({ dialCallStatus: status, unansweredUrl: "https://x/voicemail" }),
        /<Redirect method="POST">https:\/\/x\/voicemail<\/Redirect>/
      );
    });
  }
});
