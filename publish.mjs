// 피드 이름표를 블루스카이 계정에 한 번 등록한다. GitHub Actions 비밀값으로만 실행한다.
const handle = process.env.BLUESKY_HANDLE;
const password = process.env.BLUESKY_APP_PASSWORD;
const rkey = process.env.FEED_RKEY;
const serviceDid = process.env.SERVICE_DID;
if (!handle || !password || !rkey || !serviceDid) throw new Error('환경 변수가 비어 있습니다');

async function post(method, body, token) {
  const res = await fetch(`https://bsky.social/xrpc/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${res.status}`);
  return res.json();
}

const session = await post('com.atproto.server.createSession', {
  identifier: handle,
  password,
});
const result = await post('com.atproto.repo.putRecord', {
  repo: session.did,
  collection: 'app.bsky.feed.generator',
  rkey,
  record: {
    $type: 'app.bsky.feed.generator',
    did: serviceDid,
    displayName: '마음 다음 글',
    description: '내 글에 마음을 찍은 분이 1시간 안에 올린 다음 글을 모읍니다. 네오 전용 피드입니다.',
    createdAt: new Date().toISOString(),
  },
}, session.accessJwt);
console.log(result.uri);
