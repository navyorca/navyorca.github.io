// 내 글에 마음을 찍은 사람이 그다음에 올린 글을 모아 피드 뼈대 파일을 만든다.
// 공개 API만 쓰므로 비밀번호·토큰이 필요 없다.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const API = 'https://public.api.bsky.app/xrpc/';
const ME = process.env.BSKY_ACTOR || 'navyorca.bsky.social';
const OUT = process.env.OUT_DIR || '.';
const STATE = process.env.STATE_FILE || 'state.json';
const FEED_URI = process.env.FEED_URI || '';
const MY_POSTS = 25;
const MAX_LIKERS = 30;
const LIKE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const KEEP = 200;
// RepostNextPost와 같은 판정: 답글을 빼고, 마음을 찍고 1시간 안에 올린 첫 글만 담는다.
const NEXT_POST_WINDOW_MS = 60 * 60 * 1000;

async function get(method, params) {
  const url = `${API}${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'user-agent': 'like-next-post-feed' } });
  if (!res.ok) throw new Error(`${method} ${res.status}`);
  return res.json();
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE, 'utf8'));
  } catch {
    return { items: [] };
  }
}

async function recentLikes() {
  const { feed = [] } = await get('app.bsky.feed.getAuthorFeed', {
    actor: ME, limit: '100', filter: 'posts_no_replies',
  });
  const mine = feed
    .filter((x) => !x.reason && x.post.author.handle === ME && (x.post.likeCount || 0) > 0)
    .slice(0, MY_POSTS);
  const cutoff = Date.now() - LIKE_WINDOW_MS;
  const latest = new Map();
  for (const { post } of mine) {
    const { likes = [] } = await get('app.bsky.feed.getLikes', { uri: post.uri, limit: '50' });
    for (const like of likes) {
      if (like.actor.handle === ME || Date.parse(like.createdAt) < cutoff) continue;
      const earlier = latest.get(like.actor.did);
      // 같은 사람이 여러 번 찍었으면 마지막 마음을 기준으로 삼는다.
      if (!earlier || like.createdAt > earlier.likedAt) {
        latest.set(like.actor.did, { did: like.actor.did, likedAt: like.createdAt });
      }
    }
  }
  return [...latest.values()]
    .sort((a, b) => b.likedAt.localeCompare(a.likedAt))
    .slice(0, MAX_LIKERS);
}

async function nextPost({ did, likedAt }) {
  const { feed = [] } = await get('app.bsky.feed.getAuthorFeed', {
    actor: did, limit: '30', filter: 'posts_no_replies',
  });
  // 예전 날짜로 다시 올린 글이 끼지 않도록 작성 시각과 색인 시각을 함께 본다.
  const limit = Date.parse(likedAt) + NEXT_POST_WINDOW_MS;
  const next = feed
    .filter((x) => !x.reason && x.post.author.did === did)
    .map((x) => x.post)
    .filter((p) => p.record.createdAt > likedAt && p.indexedAt > likedAt)
    .sort((a, b) => a.record.createdAt.localeCompare(b.record.createdAt))[0];
  return next && Date.parse(next.record.createdAt) <= limit ? next : undefined;
}

async function write(path, text) {
  const full = join(OUT, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
}

const state = await readState();
const known = new Map(state.items.map((i) => [i.post, i]));
const likers = await recentLikes();
let found = 0;
for (const liker of likers) {
  const post = await nextPost(liker);
  if (!post || known.has(post.uri)) continue;
  known.set(post.uri, { post: post.uri, at: post.indexedAt });
  found += 1;
}
const items = [...known.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, KEEP);
await writeFile(STATE, JSON.stringify({ items }, null, 2));
await write('xrpc/app.bsky.feed.getFeedSkeleton/index.json', JSON.stringify({
  feed: items.slice(0, 100).map((i) => ({ post: i.post })),
}));
if (FEED_URI) {
  await write('xrpc/app.bsky.feed.describeFeedGenerator/index.json', JSON.stringify({
    did: FEED_URI.split('/')[2], feeds: [{ uri: FEED_URI }],
  }));
}
console.log(JSON.stringify({ likers: likers.length, newPosts: found, total: items.length }));
