export const heuristicConfig = {
  min_account_age_days: 3,
  max_urls_for_spam: 1,
  min_body_len_for_links: 40,
  spam_words: [
    "call now",
    "zadzwoń",
    "zadzwoń teraz",
    "kontakt",
    "telefon",
    "telefone",
    "contato",
    "suporte",
    "infolinii",
    "click here",
    "buy now",
    "subscribe",
    "visit",
  ],
  bracket_max: 6,
  special_char_density_threshold: 0.12,
  phone_regex: "\\+?\\d[\\d\\-\\s\\(\\)\\.]{6,}\\d",
  trusted_domains: ["astrbot.app", "github.com"],
};

const BRACKET_REGEX = /[{}\[\]<>|~^_]/g;
const SPECIAL_CHAR_REGEX =
  /[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\s]/gi;
const URL_REGEX = /https?:\/\/\S+/gi;

const DAY_IN_MS = 1000 * 60 * 60 * 24;

/**
 * 基于启发式规则评估 issue 是否需要进一步审核。
 * @param {import('probot').Context} context Probot 上下文
 * @param {object} issue Issue payload
 * @returns {Promise<{signals: string[]}>}
 */
export async function runIssueHeuristics(context, issue) {
  const config = heuristicConfig;

  const normalizedTitle = (issue?.title || "").toLowerCase();
  const normalizedBody = (issue?.body || "").toLowerCase();
  const combined = `${normalizedTitle}\n${normalizedBody}`;
  const signals = [];

  const countMatches = (text, regex) => {
    if (!text) return 0;
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  };

  const allUrls = combined.match(URL_REGEX) || [];
  const trustedDomains = config.trusted_domains || [];
  const spammyUrlCount = allUrls.filter((url) => {
    const lowerUrl = url.toLowerCase();
    return !trustedDomains.some((domain) =>
      lowerUrl.includes(domain.toLowerCase())
    );
  }).length;
  const bodyLenNoSpace = combined.replace(/\s+/g, "").length;
  const matchedSpamWords = Array.isArray(config.spam_words)
    ? config.spam_words
        .filter(
          (w) =>
            typeof w === "string" && w && combined.includes(w.toLowerCase())
        )
        .map((w) => w.toLowerCase())
    : [];
  const bracketCount =
    countMatches(normalizedTitle, BRACKET_REGEX) +
    countMatches(normalizedBody, BRACKET_REGEX);
  const specialChars = combined.match(SPECIAL_CHAR_REGEX) || [];
  const specialCharDensity = specialChars.length / Math.max(1, combined.length);

  let phoneRegexInstance = null;
  try {
    phoneRegexInstance = new RegExp(config.phone_regex, "gi");
  } catch (regexError) {
    context.log.warn(
      { err: regexError },
      "无效的电话号码正则表达式配置，已忽略。"
    );
  }
  const phoneCount =
    phoneRegexInstance && combined
      ? countMatches(combined, phoneRegexInstance)
      : 0;

  let accountAgeDays = null;
  if (issue?.user?.login) {
    try {
      const userResponse = await context.octokit.users.getByUsername({
        username: issue.user.login,
      });
      accountAgeDays =
        (Date.now() - new Date(userResponse.data.created_at).getTime()) /
        DAY_IN_MS;
    } catch (error) {
      context.log.warn({ err: error }, "获取用户信息失败，跳过账号年龄判定。");
    }
  }

  if (spammyUrlCount > config.max_urls_for_spam) {
    signals.push(
      `链接数量 (${spammyUrlCount}) 超过阈值 ${config.max_urls_for_spam}`
    );
  }

  if (
    spammyUrlCount >= 1 &&
    typeof accountAgeDays === "number" &&
    accountAgeDays < config.min_account_age_days
  ) {
    signals.push(
      `账号年龄约 ${accountAgeDays.toFixed(1)} 天，低于阈值 ${
        config.min_account_age_days
      } 天且包含链接`
    );
  }

  if (matchedSpamWords.length > 0) {
    signals.push(`命中垃圾关键词：${matchedSpamWords.join(", ")}`);
  }

  if (bodyLenNoSpace < config.min_body_len_for_links && spammyUrlCount >= 1) {
    signals.push(
      `正文有效字符仅 ${bodyLenNoSpace}，低于含链接最低要求 ${config.min_body_len_for_links}`
    );
  }

  if (bracketCount >= config.bracket_max) {
    signals.push(
      `括号/特殊括号字符数量 ${bracketCount} 超过阈值 ${config.bracket_max}`
    );
  }

  if (
    specialCharDensity >= config.special_char_density_threshold &&
    combined.length < 200
  ) {
    signals.push(
      `特殊字符密度 ${specialCharDensity.toFixed(3)} ≥ ${
        config.special_char_density_threshold
      } 且内容少于 200 字符`
    );
  }

  if (phoneCount >= 1 && bracketCount >= 2) {
    signals.push("检测到电话号码模式并伴随多个括号字符");
  }

  return {
    signals,
  };
}
