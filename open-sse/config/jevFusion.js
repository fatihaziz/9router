// DeepSWE v1.1, 113 tasks, leaderboard updated September 3, 2026.
// Source: https://deepswe.datacurve.ai/ (All effort levels), checked September 22, 2026.
// Pass@1 is a model/effort prior, not the probability a particular answer is correct.
export const JEV_FUSION = {
  judgeModel: "typesafe/jev-latest",
  endpoint: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  minConfidence: 0.5,
  timeoutMs: 3000,
  escalationModel: "cx/gpt-6-astra(medium)",
  scores: {
    "cx/gpt-5.6-sol(medium)": 61,
    "cx/gpt-5.6-luna(max)": 67,
    "ag/gemini-3.8-flash-medium": 71,
    "cx/gpt-6-astra(medium)": 73,
  },
};
