import type { Diagnostic } from './online-debug';

export const feedbackRecipient = '2228396737@qq.com';
export const feedbackMailLimit = 7500;
const trimCharacters = (value: string, limit: number) => Array.from(value).slice(0, limit).join('');

// The input is the existing allowlisted diagnostic report, never raw responses,
// request headers, credentials, filesystem paths or library/account metadata.
export function buildMusicFeedback(errorReport: string, description: string, environment: { version: string; quality: string; width: number; height: number }) {
  const diagnostic = JSON.parse(errorReport) as { errors?: Diagnostic[] };
  const errors = Array.isArray(diagnostic.errors) ? diagnostic.errors.slice(-20) : [];
  const issue = trimCharacters(description.replace(/\u0000/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD'), 3000).trim();
  const report = JSON.stringify({ environment, description: issue, errors }, null, 2);
  const summaries = errors.slice(-5).map(error => {
    const deepest = error.chain?.nodes?.filter((node: { cycle?: boolean }) => !node.cycle)
      .sort((a: { depth?: number }, b: { depth?: number }) => (b.depth || 0) - (a.depth || 0))[0];
    return { time: error.time, provider: error.provider, operation: error.operation, code: error.code,
      httpStatus: error.httpStatus, attempt: error.attempt, nodeVersion: error.nodeVersion, undiciVersion: error.undiciVersion,
      cause: deepest && { code: deepest.code, errno: deepest.errno, syscall: deepest.syscall },
      phase: error.transport?.lastRequestPhase, family: error.transport?.socketAtFailure?.family, durationMs: error.transport?.durationMs };
  });
  const subject = `Rhine Music 反馈 · ${environment.version}`;
  let text = trimCharacters(issue, 600);
  let count = summaries.length;
  const makeBody = () => `${text || '问题描述：'}\n\n版本：${environment.version}\n画质：${environment.quality}\n窗口：${environment.width} × ${environment.height}\n网易云接口：IPv4\n\n本次运行错误共 ${errors.length} 条；邮件附最近 ${count} 条摘要。\n${JSON.stringify(count ? summaries.slice(-count) : [], null, 2)}\n\n完整诊断可在设置 → 反馈中复制或保存，按需附在邮件中。`;
  const makeUrl = (body: string) => `mailto:${feedbackRecipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  let body = makeBody();
  while (makeUrl(body).length > feedbackMailLimit && (text.length || count)) {
    if (text.length > 100) text = trimCharacters(text, Math.max(0, Array.from(text).length - 100));
    else if (count > 1) count--;
    else if (text.length) text = '';
    else count--;
    body = makeBody();
  }
  return { report, body, url: makeUrl(body) };
}

export function feedbackMarkup() {
  return `<section class="panel-section" data-settings-group="feedback"><h3>问题反馈</h3><p class="feedback-address">${feedbackRecipient}</p><label class="field-label" for="feedback-description">问题描述</label><textarea class="feedback-description" id="feedback-description" maxlength="3000" placeholder="发生了什么、如何重现…"></textarea><p class="quality-note">邮件自动带入错误摘要。完整诊断可复制或保存，不包含登录凭据、账号资料和本地歌曲路径。</p><details class="feedback-diagnostics"><summary>查看完整诊断</summary><textarea id="feedback-report" class="feedback-report" readonly aria-label="反馈诊断信息" spellcheck="false"></textarea></details><div class="panel-actions"><button class="primary-button" data-action="compose-feedback">撰写反馈邮件 ↗</button><button class="text-button" data-action="copy-feedback">复制完整诊断</button><button class="text-button" data-action="save-feedback">保存诊断文件</button></div><p class="feedback-status" id="feedback-status" role="status" aria-live="polite"></p></section>`;
}
