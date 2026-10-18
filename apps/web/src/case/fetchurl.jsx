// Fills a form from a public-record page the server fetches itself (only
// national and local government domains, whose works are free to use).
import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, NetError } from '../app/api.js';
import { Btn, cx } from '../ui/kit.jsx';

export function FetchFromUrl({ url, onFill, onRecorded }) {
  const [raw, setSt] = useState(null);
  // a message belongs to the address it was about; a new address or a cleared form drops it
  const st = raw && (raw.busy || raw.for === url) ? raw : null;
  const run = async () => {
    setSt({ busy: true, for: url });
    try {
      const res = await api('previewSource', { body: { url } });
      if (!res.ok) { setSt({ for: url, error: res.error.details && res.error.details[0] ? res.error.details[0].reason : res.error.message }); return; }
      onFill(res.data);
      if (onRecorded) onRecorded(res.data.published_at);
      setSt({ for: res.data.final_url || url, ok: `원문 ${[...res.data.text].length.toLocaleString('ko-KR')}자를 가져왔습니다. 내용을 확인한 뒤 등록하세요.` });
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setSt({ for: url, error: '서버에 닿지 않았습니다.' });
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Btn size="sm" kind="soft" icon={Download} busy={st && st.busy} disabled={!/^https?:\/\/\S+$/.test(url || '')} onClick={run}>주소에서 원문 가져오기</Btn>
      <span className={cx('min-w-0 flex-1 text-xs', st && st.error ? 'text-negative-ink' : 'text-g500')} role={st ? 'status' : undefined}>
        {st && st.error ? st.error : st && st.ok ? st.ok : st && st.busy ? '정부·지자체 사이트에서 원문을 받는 중입니다.' : '정부·지자체 공개 자료(go.kr, korea.kr, kosis.kr) 주소만 가져옵니다. 그 밖의 자료는 원문을 직접 붙여 넣으세요.'}
      </span>
    </div>
  );
}
