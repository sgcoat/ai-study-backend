export type CodePurpose = 'login' | 'delete_account';

export function createCodeEmail(code: string, purpose: CodePurpose = 'login') {
  if (!/^\d{6}$/.test(code)) throw new Error('인증 코드는 6자리 숫자여야 합니다.');
  const label = purpose === 'login' ? '로그인' : '계정 삭제';
  const notice = purpose === 'delete_account'
    ? '계정을 삭제하면 자료, 이미지, 요약, 문제와 학습 기록을 복구할 수 없습니다.'
    : 'AI Study에 로그인하려면 아래 인증 코드를 입력해 주세요.';
  return {
    subject: `AI Study ${label} 인증 코드`,
    text: `${label} 인증 코드: ${code}\n\n${notice}\n\n5분 안에 입력하세요.\n본인이 요청하지 않았다면 이 이메일을 무시하세요. 인증 코드를 다른 사람에게 알려주지 마세요.`,
    // Only a validated numeric code and fixed copy enter this HTML. No user-supplied HTML or remote assets.
    html: `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#F5F6FA;font-family:Arial,'Apple SD Gothic Neo',sans-serif;color:#172033">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;background:#FFFFFF;border-radius:16px">
        <tr><td style="padding:32px">
          <p style="margin:0 0 20px;font-size:14px;font-weight:bold;color:#5B5FEF">AI STUDY</p>
          <h1 style="margin:0 0 16px;font-size:24px">${label} 인증 코드</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.7">${notice}</p>
          <p style="margin:0 0 24px;padding:20px;text-align:center;background:#F0F1FF;border-radius:12px;font-size:34px;font-weight:bold;letter-spacing:8px">${code}</p>
          <p style="margin:0;font-size:14px;line-height:1.7">이 코드는 <strong>5분 동안</strong> 유효합니다.<br>앱으로 돌아가 위 6자리 숫자를 입력해 주세요.</p>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.7;color:#697488">본인이 요청하지 않았다면 이 이메일을 무시하세요.<br>인증 코드를 다른 사람에게 알려주지 마세요.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
