import assert from "node:assert/strict";
import test from "node:test";
import { APICallError } from "ai";
import { classifyModelFailure } from "../src/model/failure-classifier.js";

function badRequest(responseBody: string) {
  return new APICallError({
    message: "Bad Request",
    url: "https://api.example.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody,
    isRetryable: false,
  });
}

test("400 时带上 provider 自己给的拒绝原因（回归）", () => {
  // 之前只输出「Provider rejected the model request.」，用户拿不到任何线索。
  const failure = classifyModelFailure(
    badRequest(JSON.stringify({ error: { message: "Unsupported parameter: max_tokens" } })),
  );
  assert.equal(failure.code, "invalid_model_request");
  assert.match(failure.message, /Unsupported parameter: max_tokens/u);
});

test("兼容 message / detail 字段与纯文本", () => {
  const fromMessage = classifyModelFailure(badRequest(JSON.stringify({ message: "bad model" })));
  assert.match(fromMessage.message, /bad model/u);

  const fromDetail = classifyModelFailure(badRequest(JSON.stringify({ detail: "no such model" })));
  assert.match(fromDetail.message, /no such model/u);
});

test("HTML 错误页不作为原因展示", () => {
  const failure = classifyModelFailure(badRequest("<html><body>502</body></html>"));
  assert.doesNotMatch(failure.message, /<html>/u);
});

test("过长的原因被截断", () => {
  const long = "x".repeat(1000);
  const failure = classifyModelFailure(badRequest(JSON.stringify({ message: long })));
  assert.ok(failure.message.length < 400, failure.message.length.toString());
  assert.match(failure.message, /…$/u);
});
