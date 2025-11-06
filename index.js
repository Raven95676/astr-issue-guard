import OpenAI from "openai";
import {
  spamModerationSystemPrompt,
  buildSpamModerationUserPrompt,
} from "./prompts.js";
import { runIssueHeuristics } from "./heuristics.js";

async function runAiModeration(context, issue, heuristicSignals = []) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 未配置，无法执行垃圾内容检测。");
  }

  const model = process.env.OPENAI_MODEL;
  if (!model) {
    throw new Error("OPENAI_MODEL 未配置，无法执行垃圾内容检测。");
  }

  const clientOptions = { apiKey };
  const baseURL = process.env.OPENAI_BASE_URL;
  if (baseURL) {
    clientOptions.baseURL = baseURL;
  }

  const client = new OpenAI(clientOptions);

  const userPrompt = buildSpamModerationUserPrompt({
    title: issue?.title,
    body: issue?.body,
    author: issue?.user?.login,
    heuristicSignals,
  });

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: spamModerationSystemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    temperature: 0,
  });

  const rawText = completion.choices[0]?.message?.content;

  if (!rawText) {
    context.log.warn("模型返回内容为空。");
    return null;
  }

  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed?.is_spam !== "boolean") {
      context.log.warn("模型返回的 JSON 结构不符合预期，缺少 is_spam 字段。");
      return null;
    }

    return {
      isSpam: parsed.is_spam,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (parseError) {
    context.log.error({ err: parseError }, "模型返回内容非 JSON，无法解析。");
    return null;
  }
}

function composeSpamComment(decision) {
  const lines = ["注意：此 issue 已被自动识别为垃圾信息并已关闭。"];

  if (decision.reason) {
    lines.push(`原因：${decision.reason}`);
  }

  lines.push("如认为这是误判，请补充更多有效信息后重新提交或联系维护者。");

  return lines.join("\n");
}

/**
 * Probot 应用的主函数。
 * @param {import('probot').Probot} app Probot 应用实例。
 */
export default (app) => {
  app.log.info("astr-issue-guard 已加载");

  app.on(["issues.opened", "issues.edited"], async (context) => {
    const issue = context.payload.issue;
    if (!issue) {
      return;
    }

    if (issue.state === "closed") {
      return;
    }

    const heuristicResult = await runIssueHeuristics(context, issue);

    let decision = null;
    try {
      decision = await runAiModeration(
        context,
        issue,
        heuristicResult?.signals || []
      );
    } catch (error) {
      context.log.error({ err: error }, "调用模型判定垃圾内容失败。");
      return;
    }

    if (!decision) {
      context.log.error(
        { issue_number: issue.number },
        "未能解析模型判定结果，跳过处理。"
      );
      return;
    }

    context.log.info(
      {
        issue_number: issue.number,
        is_spam: decision.isSpam,
        heuristic_signals: heuristicResult.signals,
      },
      "AI 审核已完成。"
    );

    if (!decision.isSpam) {
      return;
    }

    try {
      await context.octokit.issues.addLabels(
        context.issue({ labels: ["spam"] })
      );
    } catch (error) {
      context.log.warn({ err: error }, "添加 spam 标签失败，继续后续处理。");
    }

    const commentBody = composeSpamComment(decision);

    try {
      await context.octokit.issues.createComment(
        context.issue({ body: commentBody })
      );
    } catch (commentError) {
      context.log.error({ err: commentError }, "发表垃圾信息提示评论失败。");
    }

    try {
      await context.octokit.issues.update(
        context.issue({ state: "closed", state_reason: "not_planned" })
      );
    } catch (closeError) {
      context.log.error({ err: closeError }, "关闭垃圾 issue 失败。");
    }
  });
};
