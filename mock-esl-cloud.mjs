// -----------------------------------------------------------------------------
// mock-esl-cloud.mjs — a local stand-in for MinewTag ESL Cloud, for testing
// the app's CLOUD integration path with no hardware and no vendor account.
//
// It implements the four endpoints lib/minew.js calls and answers each with the
// vendor's success envelope: HTTP 200 + JSON { code: 0 }. Zero dependencies —
// just Node's built-in http.
//
//   node mock-esl-cloud.mjs            # listens on http://localhost:9444
//   MOCK_PORT=5000 node mock-esl-cloud.mjs
//
// Then in the app: store Settings -> Integration
//   mode      = CLOUD
//   cloud URL = http://localhost:9444
//   token     = any-non-empty-string
//
// Failure simulation (to exercise the queue's retry/backoff and error UI):
//   - a label whose mac contains "fail" -> permanent business error (code 1)
//   - a label whose mac contains "slow" -> 3s delay before responding
//   - a label whose mac contains "err5" -> HTTP 500 (retryable)
// -----------------------------------------------------------------------------
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 9444);

// A little in-memory inventory so label/gateway list calls return plausible data.
const GATEWAYS = [
  { mac: "AC233FAA0001", name: "Mock Gateway 1", model: "G1-E", status: "online", rssi: -52 },
];
const LABELS = [
  { mac: "AC233FBB0001", status: "online", battery: 96, rssi: -61 },
  { mac: "AC233FBB0002", status: "online", battery: 88, rssi: -70 },
];

const ok = (extra = {}) => ({ code: 0, message: "ok", ...extra });
const fail = (message) => ({ code: 1, message });

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({ __unparsed: data });
      }
    });
  });
}

const send = (res, status, obj) => {
  const payload = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
};

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${req.method} ${req.url}  token=${token || "(none)"}  body=${JSON.stringify(body)}`);

  // The app always POSTs; anything else is a misconfiguration worth surfacing.
  if (req.method !== "POST") return send(res, 405, fail("method not allowed"));

  switch (req.url) {
    // --- push a rendered label to a tag -------------------------------------
    case "/apis/esl/label/refresh": {
      const mac = String(body.mac ?? "");
      if (mac.includes("err5")) return send(res, 500, fail("simulated server error"));
      if (mac.includes("fail")) return send(res, 200, fail("simulated permanent rejection"));
      const respond = () => send(res, 200, ok({ mac, taskId: `task_${Date.now()}` }));
      if (mac.includes("slow")) return void setTimeout(respond, 3000);
      return respond();
    }

    // --- poll label device states -------------------------------------------
    case "/apis/esl/label/list":
      return send(res, 200, ok({ total: LABELS.length, list: LABELS }));

    // --- poll gateway device states -----------------------------------------
    case "/apis/esl/gateway/list":
      return send(res, 200, ok({ total: GATEWAYS.length, list: GATEWAYS }));

    // --- flash a tag's LED ---------------------------------------------------
    case "/apis/esl/label/led":
      return send(res, 200, ok({ mac: body.mac ?? null }));

    default:
      return send(res, 404, fail(`no such endpoint: ${req.url}`));
  }
});

server.listen(PORT, () => {
  console.log(`mock ESL Cloud listening on http://localhost:${PORT}`);
  console.log("point the store's Integration -> cloud URL at this address (mode CLOUD).");
});
