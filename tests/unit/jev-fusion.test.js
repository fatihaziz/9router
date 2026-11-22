import { afterEach, expect, it, vi } from "vitest";
import { handleFusionChat } from "../../open-sse/services/combo.js";

const models = ["cx/gpt-5.6-sol(medium)", "cx/gpt-5.6-luna(max)", "ag/gemini-3.8-flash-medium"];
const log = { info() {}, warn() {} };
const completion = (text) => Response.json({ choices: [{ message: { role: "assistant", content: text } }] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses DeepSWE rank among JEV-approved completed answers, not among all models", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-only");
  const completed = [];
  vi.stubGlobal("fetch", async (_url, options) => {
    expect(completed).toHaveLength(3);
    const request = JSON.parse(options.body);
    expect(request.state.candidates.map((a) => a.text)).toEqual(["Sol proposal", "Luna proposal", "Gemini proposal"]);
    return Response.json({ answers: {
      candidate_0: { type: "choice", choice: "usable", confidence: 0.99 },
      candidate_1: { type: "choice", choice: "usable", confidence: 0.8 },
      candidate_2: { type: "choice", choice: "uncertain", confidence: 0.9 },
    } });
  });
  const result = await handleFusionChat({
    body: { messages: [{ role: "user", content: "Solve the problem" }], stream: true, tools: [{ type: "function", function: { name: "inspect" } }] },
    models, judgeModel: "typesafe/jev-latest", log,
    handleSingleModel: async (body, model, isPanel) => {
      if (isPanel) {
        const text = ["Sol proposal", "Luna proposal", "Gemini proposal"][models.indexOf(model)];
        completed.push(model);
        return completion(text);
      }
      expect(model).toBe(models[1]);
      expect(body.stream).toBe(true);
      expect(body.tools[0].function.name).toBe("inspect");
      expect(body.messages.at(-1).content).toContain("Luna proposal");
      return completion("Approved Luna result");
    },
  });
  expect((await result.json()).choices[0].message.content).toBe("Approved Luna result");
});

it("escalates exactly once to Astra medium only when every verdict is uncertain", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-only");
  vi.stubGlobal("fetch", async () => Response.json({ answers: {
    candidate_0: { type: "choice", choice: "uncertain", confidence: 0.99 },
    candidate_1: { type: "choice", choice: "usable", confidence: 0.1 },
    candidate_2: { type: "choice", choice: "uncertain", confidence: 0.9 },
  } }));
  let escalations = 0;
  const response = await handleFusionChat({
    body: { messages: [{ role: "user", content: "Resolve the contradiction" }] },
    models, judgeModel: "typesafe/jev-latest", log,
    handleSingleModel: async (_body, model, isPanel) => {
      if (isPanel) return completion("Unverified proposal");
      expect(model).toBe("cx/gpt-6-astra(medium)");
      escalations++;
      return completion("Resolved by Astra");
    },
  });
  expect((await response.json()).choices[0].message.content).toBe("Resolved by Astra");
  expect(escalations).toBe(1);
});

it("selects the highest DeepSWE-ranked answer when all are usable", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-only");
  vi.stubGlobal("fetch", async () => Response.json({ answers: Object.fromEntries(
    models.map((_, i) => [`candidate_${i}`, { type: "choice", choice: "usable", confidence: 0.8 }])
  ) }));
  const response = await handleFusionChat({
    body: { messages: [{ role: "user", content: "Q" }] },
    models, judgeModel: "typesafe/jev-latest", log,
    handleSingleModel: async (_body, model) => completion(model),
  });
  expect((await response.json()).choices[0].message.content).toBe(models[2]);
});

it.each(["http-error", "missing-verdict", "invalid-confidence", "timeout"])(
  "does not silently accept or escalate an unjudged panel on %s",
  async (failure) => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-only");
    vi.stubGlobal("fetch", async () => {
      if (failure === "timeout") throw new DOMException("Timeout", "TimeoutError");
      if (failure === "http-error") return new Response("", { status: 429 });
      return Response.json({ answers: failure === "missing-verdict" ? {} : {
        candidate_0: { type: "choice", choice: "usable", confidence: 2 },
      } });
    });
    let finalCalls = 0;
    const response = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models, judgeModel: "typesafe/jev-latest", log,
      handleSingleModel: async (_body, _model, isPanel) => {
        if (!isPanel) finalCalls++;
        return completion("Proposal");
      },
    });
    expect(response.status).toBe(502);
    expect(finalCalls).toBe(0);
  }
);

it("does not mistake a missing panel response for three uncertain answers", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-only");
  const judge = vi.fn();
  vi.stubGlobal("fetch", judge);
  const response = await handleFusionChat({
    body: { messages: [{ role: "user", content: "Q" }] },
    models, judgeModel: "typesafe/jev-latest", log,
    handleSingleModel: async (_body, model, isPanel) => {
      expect(isPanel).toBe(true);
      return model === models[2] ? new Response("", { status: 429 }) : completion("Proposal");
    },
  });
  expect(response.status).toBe(503);
  expect(judge).not.toHaveBeenCalled();
});
